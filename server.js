const jwt = require('jsonwebtoken');
const express = require('express');
const JWT_SECRET = 'client_progress_manager_secret_key';
const cors = require('cors');
const db = require('./db');

const app = express();

console.log('SERVER FILE LOADED');

app.use(cors());
app.use(express.json());

/* ------------------ ROOT ------------------ */

app.get('/', (req, res) => {
  res.send('API is running');
});

/* ------------------ LOGIN ------------------ */

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  const sql = 'SELECT * FROM users WHERE email = ? AND password = ?';

  db.query(sql, [email, password], (err, results) => {
    if (err) {
      console.log('LOGIN ERROR:', err);
      return res.status(500).json({
        success: false,
        message: 'Database error',
        error: err.message,
      });
    }

    if (results.length > 0) {
      const user = results[0];

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        message: 'Login successful',
        token: token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }
  });
});

/* ------------------ ADD PROJECT ------------------ */

app.post('/add-project', (req, res) => {
  const { client_id, project_name, progress, total_cost } = req.body;

  const balance = total_cost;

  const sql = `
    INSERT INTO projects
    (client_id, project_name, progress, total_cost, paid_amount, balance_amount)
    VALUES (?, ?, ?, ?, 0, ?)
  `;

  db.query(sql, [client_id, project_name, progress, total_cost, balance], (err) => {
    if (err) {
      console.log('PROJECT ERROR:', err);
      return res.status(500).json({
        success: false,
        message: 'Database error',
      });
    }

    res.json({
      success: true,
      message: 'Project created successfully',
    });
  });
});

/* ------------------ ADD ASSET ------------------ */

app.post('/add-asset', (req, res) => {
  console.log('ASSET REQUEST BODY:', req.body);

  const { project_id, asset_name, quantity, unit_price } = req.body;

  const total_price = Number(quantity) * Number(unit_price);

  const insertSql = `
    INSERT INTO assets (project_id, asset_name, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(
    insertSql,
    [project_id, asset_name, quantity, unit_price, total_price],
    (err, result) => {
      if (err) {
        console.log('ASSET DATABASE ERROR:', err);
        return res.status(500).json({
          success: false,
          message: 'Database error',
          error: err.message,
        });
      }

      const updateSql = `
        UPDATE projects p
        SET
          p.total_cost = (
            SELECT IFNULL(SUM(total_price), 0)
            FROM assets
            WHERE project_id = ?
          ),
          p.balance_amount = (
            SELECT IFNULL(SUM(total_price), 0)
            FROM assets
            WHERE project_id = ?
          ) - p.paid_amount
        WHERE p.id = ?
      `;

      db.query(updateSql, [project_id, project_id, project_id], (updateErr, updateResult) => {
        if (updateErr) {
          console.log('PROJECT ASSET UPDATE ERROR:', updateErr);
          return res.status(500).json({
            success: false,
            message: 'Asset saved but project totals failed to update',
            error: updateErr.message,
          });
        }

        console.log('ASSET INSERTED:', result);
        console.log('PROJECT UPDATED AFTER ASSET:', updateResult);

        res.json({
          success: true,
          message: 'Asset added successfully and totals updated',
        });
      });
    }
  );
});

/* ------------------ ADD PAYMENT ------------------ */

app.post('/add-payment', (req, res) => {
  console.log('PAYMENT REQUEST BODY:', req.body);

  const { project_id, amount, payment_date, note } = req.body;

  const insertSql = `
    INSERT INTO payments (project_id, amount, payment_date, note)
    VALUES (?, ?, ?, ?)
  `;

  db.query(insertSql, [project_id, amount, payment_date, note], (err, result) => {
    if (err) {
      console.log('PAYMENT DATABASE ERROR:', err);
      return res.status(500).json({
        success: false,
        message: 'Database error',
        error: err.message,
      });
    }

    const updateSql = `
      UPDATE projects p
      SET 
        p.paid_amount = (
          SELECT IFNULL(SUM(amount), 0)
          FROM payments
          WHERE project_id = ?
        ),
        p.balance_amount = p.total_cost - (
          SELECT IFNULL(SUM(amount), 0)
          FROM payments
          WHERE project_id = ?
        )
      WHERE p.id = ?
    `;

    db.query(updateSql, [project_id, project_id, project_id], (updateErr, updateResult) => {
      if (updateErr) {
        console.log('PROJECT PAYMENT UPDATE ERROR:', updateErr);
        return res.status(500).json({
          success: false,
          message: 'Payment saved but project totals failed to update',
          error: updateErr.message,
        });
      }

      console.log('PAYMENT INSERTED:', result);
      console.log('PROJECT UPDATED AFTER PAYMENT:', updateResult);

      res.json({
        success: true,
        message: 'Payment created successfully and totals updated',
      });
    });
  });
});

/* ------------------ CLIENT DASHBOARD ------------------ */

app.get('/client-dashboard/:clientId', (req, res) => {
  const clientId = req.params.clientId;

  const sql = `
    SELECT 
      p.id,
      p.project_name,
      p.progress,
      IFNULL(SUM(DISTINCT a.total_price),0) AS total_asset_cost,
      IFNULL((SELECT SUM(amount) FROM payments WHERE project_id=p.id),0) AS total_paid
    FROM projects p
    LEFT JOIN assets a ON p.id = a.project_id
    WHERE p.client_id = ?
    GROUP BY p.id
    LIMIT 1
  `;

  db.query(sql, [clientId], (err, results) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ success: false });
    }

    if (results.length === 0) {
      return res.json({
        success: false,
        message: 'No project found',
      });
    }

    const project = results[0];
    const balance = project.total_asset_cost - project.total_paid;

    res.json({
      success: true,
      data: {
        projectId: project.id,
        projectName: project.project_name,
        progress: project.progress,
        totalAssetCost: project.total_asset_cost,
        totalPaid: project.total_paid,
        balance: balance,
      },
    });
  });
});

/* ------------------ PROJECT SUMMARY ------------------ */

app.get('/project-summary/:projectId', (req, res) => {
  const projectId = req.params.projectId;

  const projectSql = `
    SELECT 
      p.id,
      p.project_name,
      p.progress,
      p.total_cost,
      p.paid_amount,
      p.balance_amount,
      u.name AS client_name
    FROM projects p
    LEFT JOIN users u ON p.client_id = u.id
    WHERE p.id = ?
  `;

  const assetsSql = `
    SELECT *
    FROM assets
    WHERE project_id = ?
  `;

  const paymentsSql = `
    SELECT *
    FROM payments
    WHERE project_id = ?
  `;

  db.query(projectSql, [projectId], (err, project) => {
    if (err) {
      console.log('PROJECT SUMMARY PROJECT ERROR:', err);
      return res.status(500).json({ success: false });
    }

    db.query(assetsSql, [projectId], (err, assets) => {
      if (err) {
        console.log('PROJECT SUMMARY ASSETS ERROR:', err);
        return res.status(500).json({ success: false });
      }

      db.query(paymentsSql, [projectId], (err, payments) => {
        if (err) {
          console.log('PROJECT SUMMARY PAYMENTS ERROR:', err);
          return res.status(500).json({ success: false });
        }

        res.json({
          success: true,
          data: {
            project: project[0],
            assets: assets,
            payments: payments,
          },
        });
      });
    });
  });
});

/* ------------------ PROJECT LIST ------------------ */

app.get('/projects', (req, res) => {
  const sql = `
    SELECT 
      p.id,
      p.project_name,
      p.progress,
      p.total_cost,
      p.paid_amount,
      p.balance_amount,
      u.name AS client_name
    FROM projects p
    LEFT JOIN users u ON p.client_id = u.id
    ORDER BY p.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.log('PROJECT LIST ERROR:', err);
      return res.status(500).json({ success: false });
    }

    res.json({
      success: true,
      data: results,
    });
  });
});

/* ------------------ CLIENT LIST ------------------ */

app.get('/clients', (req, res) => {
  const sql = `
    SELECT id, name, email
    FROM users
    WHERE role = 'client'
    ORDER BY name
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.log('CLIENT LIST ERROR:', err);
      return res.status(500).json({ success: false });
    }

    res.json({
      success: true,
      data: results,
    });
  });
});

/* ------------------ PROJECT OPTIONS ------------------ */

app.get('/project-options', (req, res) => {
  const sql = `
    SELECT id, project_name
    FROM projects
    ORDER BY project_name
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.log('PROJECT OPTIONS ERROR:', err);
      return res.status(500).json({ success: false });
    }

    res.json({
      success: true,
      data: results,
    });
  });
});

/* ------------------ AUTH MIDDLEWARE ------------------ */

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token format',
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      });
    }

    req.user = decoded;
    next();
  });
}

/* ------------------ TEST ROUTE ------------------ */

app.get('/projects', verifyToken, (req, res) => {
  res.json({
    success: true,
    message: 'SERVER WORKING',
  });
});

/* ------------------ ROUTE CHECK ------------------ */

app.get('/zzz-check-777', (req, res) => {
  res.json({
    success: true,
    message: 'THIS IS THE NEW SERVER FILE',
  });
});

/* ------------------ CLIENT PROJECTS ------------------ */

app.get('/client-projects/:clientId', (req, res) => {
  const clientId = req.params.clientId;

  const sql = `
    SELECT
      id,
      project_name,
      progress,
      total_cost,
      paid_amount,
      balance_amount
    FROM projects
    WHERE client_id = ?
    ORDER BY id DESC
  `;

  db.query(sql, [clientId], (err, results) => {
    if (err) {
      console.log('CLIENT PROJECTS ERROR:', err);
      return res.status(500).json({
        success: false,
        message: 'Database error',
        error: err.message,
      });
    }

    res.json({
      success: true,
      data: results,
    });
  });
});

/* ------------------ DELETE PROJECT ------------------ */

app.delete('/delete-project/:projectId', (req, res) => {
  const projectId = req.params.projectId;

  const deletePaymentsSql = `
    DELETE FROM payments
    WHERE project_id = ?
  `;

  const deleteAssetsSql = `
    DELETE FROM assets
    WHERE project_id = ?
  `;

  const deleteProjectSql = `
    DELETE FROM projects
    WHERE id = ?
  `;

  db.query(deletePaymentsSql, [projectId], (paymentErr) => {
    if (paymentErr) {
      console.log('DELETE PAYMENTS ERROR:', paymentErr);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete project payments',
        error: paymentErr.message,
      });
    }

    db.query(deleteAssetsSql, [projectId], (assetErr) => {
      if (assetErr) {
        console.log('DELETE ASSETS ERROR:', assetErr);
        return res.status(500).json({
          success: false,
          message: 'Failed to delete project assets',
          error: assetErr.message,
        });
      }

      db.query(deleteProjectSql, [projectId], (projectErr, result) => {
        if (projectErr) {
          console.log('DELETE PROJECT ERROR:', projectErr);
          return res.status(500).json({
            success: false,
            message: 'Failed to delete project',
            error: projectErr.message,
          });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({
            success: false,
            message: 'Project not found',
          });
        }

        res.json({
          success: true,
          message: 'Project deleted successfully',
        });
      });
    });
  });
});

/* ------------------ UPDATE PROJECT PROGRESS ------------------ */

app.put('/update-project-progress/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  const { progress } = req.body;

  const sql = `
    UPDATE projects
    SET progress = ?
    WHERE id = ?
  `;

  db.query(sql, [progress, projectId], (err, result) => {
    if (err) {
      console.log('UPDATE PROJECT PROGRESS ERROR:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to update project progress',
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    res.json({
      success: true,
      message: 'Project progress updated successfully',
    });
  });
});

/* ------------------ ADD CLIENT ------------------ */

app.post('/add-client', (req, res) => {
  const { name, email, password, phone, company_name } = req.body;

  console.log('ADD CLIENT BODY:', req.body);

  if (!name || !email || !password || !phone) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, password and phone are required',
    });
  }

  const checkQuery = 'SELECT * FROM users WHERE email = ?';

  db.query(checkQuery, [email], (checkErr, checkResult) => {
    if (checkErr) {
      console.log('CHECK USER ERROR:', checkErr);
      return res.status(500).json({
        success: false,
        message: 'Database error',
        error: checkErr.message,
      });
    }

    if (checkResult.length > 0) {
      return res.json({
        success: false,
        message: 'Email already exists',
      });
    }

    const insertQuery = `
      INSERT INTO users (name, email, password, role)
      VALUES (?, ?, ?, 'client')
    `;

    db.query(insertQuery, [name, email, password], (insertErr, result) => {
      if (insertErr) {
        console.log('INSERT USER ERROR:', insertErr);
        return res.status(500).json({
          success: false,
          message: 'Failed to add client',
          error: insertErr.message,
        });
      }

      return res.json({
        success: true,
        message: 'Client added successfully',
        clientId: result.insertId,
      });
    });
  });
});

/* ------------------ 404 ------------------ */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

/* ------------------ SERVER ------------------ */

app.listen(3002, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:3002');
});