const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

const pool = mysql.createPool({
    host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: 'bHEitaKtTPBTcrk.root',
    password: 'qPOxc0nuVez63w32',
    database: 'test', 
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

pool.on('error', (err) => {
    console.error('🔥 [TiDB Pool Notice] Koneksi terputus/reset:', err.code || err.message);
});

process.on('uncaughtException', (err) => {
    console.error('🔥 [ANTI-CRASH] Uncaught Exception:', err.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 [ANTI-CRASH] Unhandled Rejection:', reason);
});

async function ensureSchemaLengths() {
    try {
        await pool.query(`ALTER TABLE inventory MODIFY COLUMN grade VARCHAR(255) NULL`);
        await pool.query(`ALTER TABLE inventory MODIFY COLUMN grader VARCHAR(255) NULL`);
        await pool.query(`ALTER TABLE inventory MODIFY COLUMN card_number VARCHAR(255) NULL`);
        await pool.query(`ALTER TABLE inventory MODIFY COLUMN cert_number VARCHAR(255) NULL`);
        await pool.query(`ALTER TABLE inventory MODIFY COLUMN card_condition VARCHAR(255) NULL`);
        await pool.query(`ALTER TABLE inventory MODIFY COLUMN set_code VARCHAR(255) NULL`);
        await pool.query(`ALTER TABLE inventory MODIFY COLUMN category VARCHAR(255) NULL`);
        await pool.query(`ALTER TABLE inventory MODIFY COLUMN language VARCHAR(255) NULL`);
        await pool.query(`ALTER TABLE inventory MODIFY COLUMN name VARCHAR(255) NOT NULL`);
        await pool.query(`ALTER TABLE inventory MODIFY COLUMN set_name VARCHAR(255) NULL`);
        // Add created_at column if it doesn't exist yet
        await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        console.log("✅ Skema database diperbarui.");
    } catch (e) {
        console.log("Catatan auto-check skema:", e.message);
    }
}
ensureSchemaLengths();

app.get('/api/inventory', async (req, res) => {
    try {
        let rows;
        try {
            [rows] = await pool.query('SELECT * FROM inventory ORDER BY created_at DESC');
        } catch (retryErr) {
            if (retryErr.code === 'ECONNRESET' || retryErr.code === 'PROTOCOL_CONNECTION_LOST') {
                console.log("🔄 Re-querying TiDB setelah ECONNRESET...");
                [rows] = await pool.query('SELECT * FROM inventory ORDER BY created_at DESC');
            } else {
                throw retryErr;
            }
        }
        res.status(200).json(rows);
    } catch (error) {
        console.error("Gagal ambil data:", error);
        res.status(500).json({ 
            error: 'Gagal mengambil data dari server',
            alasan_asli: error.message,
            kode_error: error.code
        });
    }
});

app.post('/api/inventory', async (req, res) => {
    try {
        const { name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, notes, card_condition, cert_number, grader, grade } = req.body;
        
        const id = crypto.randomUUID();
        await pool.query(
            `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Vault')`,
            [id, name, category, set_name || '-', set_code || null, card_number || null, language || 'English', quantity || 1, purchase_price || 0, market_price || 0, notes || null, card_condition || null, req.body.is_holo?1:0, req.body.is_first_edition?1:0, grader || null, grade || null, cert_number || null]
        );
        res.status(201).json({ message: 'Saved' });
    } catch (error) { res.status(500).json({ error: 'Gagal simpan' }); }
});

app.put('/api/inventory/:id', async (req, res) => {
    try {
        const { name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, notes, card_condition, cert_number, grader, grade } = req.body;
        
        await pool.query(
            `UPDATE inventory SET name=?, category=?, set_name=?, set_code=?, card_number=?, language=?, quantity=?, purchase_price=?, market_price=?, notes=?, card_condition=?, is_holo=?, is_first_edition=?, grader=?, grade=?, cert_number=? WHERE id=?`,
            [name, category, set_name || '-', set_code || null, card_number || null, language || 'English', quantity || 1, purchase_price || 0, market_price || 0, notes || null, card_condition || null, req.body.is_holo?1:0, req.body.is_first_edition?1:0, grader || null, grade || null, cert_number || null, req.params.id]
        );
        res.status(200).json({ message: 'Updated' });
    } catch (error) { res.status(500).json({ error: 'Gagal update' }); }
});

app.delete('/api/inventory/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM inventory WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Deleted' });
    } catch (error) { res.status(500).json({ error: 'Gagal hapus' }); }
});

async function processSale(id, sell_qty, price_per_unit, trx_id) {
    const [rows] = await pool.query('SELECT * FROM inventory WHERE id = ?', [id]);
    if(rows.length === 0) return;
    const item = rows[0]; const sq = parseInt(sell_qty);
    
    await pool.query('UPDATE inventory SET quantity = quantity - ? WHERE id = ?', [sq, id]);
    
    const newId = crypto.randomUUID();
    await pool.query(
        `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status, sold_price, transaction_id, sold_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Sold', ?, ?, NOW())`,
        [
            newId, 
            item.name || 'Unknown', 
            item.category || 'Single', 
            item.set_name || '-', 
            item.set_code || null, 
            item.card_number || null, 
            item.language || 'English', 
            sq, 
            item.purchase_price || 0, 
            item.market_price || 0, 
            item.notes || null, 
            item.card_condition || null, 
            item.is_holo || 0, 
            item.is_first_edition || 0, 
            item.grader || null, 
            item.grade || null, 
            item.cert_number || null, 
            price_per_unit || 0, 
            trx_id || null
        ]
    );
}

app.put('/api/inventory/:id/sell', async (req, res) => {
    try {
        await processSale(req.params.id, req.body.sell_qty || 1, (req.body.sold_price || 0) / (req.body.sell_qty || 1), crypto.randomUUID());
        res.status(200).json({ message: 'Sold' });
    } catch (error) { 
        console.error("ERROR JUAL SINGLE:", error);
        res.status(500).json({ error: error.message || 'Gagal jual satuan' }); 
    }
});

app.post('/api/inventory/bulk-sell', async (req, res) => {
    try {
        const { items, total_price } = req.body; 
        const trx_id = crypto.randomUUID(); 
        const total_qty = items.reduce((sum, i) => sum + parseInt(i.sell_qty), 0);
        const price_per_unit = total_price / total_qty;
        for(let i=0; i<items.length; i++) { await processSale(items[i].id, items[i].sell_qty, price_per_unit, trx_id); }
        res.status(200).json({ message: 'Success' });
    } catch (error) { 
        console.error("ERROR JUAL BORONGAN:", error);
        res.status(500).json({ error: error.message || 'Gagal jual borongan' }); 
    }
});

app.put('/api/inventory/:id/undo-sell', async (req, res) => {
    try {
        const id = req.params.id;
        const [rows] = await pool.query('SELECT * FROM inventory WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const soldItem = rows[0];

        const [vaultRows] = await pool.query(
            `SELECT * FROM inventory WHERE status = 'Vault' AND name = ? AND category = ? AND set_name = ? AND language = ? AND card_condition = ? AND is_holo = ? AND is_first_edition = ? AND set_code <=> ? AND card_number <=> ? AND grader <=> ? AND grade <=> ? AND cert_number <=> ?`, 
            [soldItem.name, soldItem.category, soldItem.set_name, soldItem.language, soldItem.card_condition, soldItem.is_holo, soldItem.is_first_edition, soldItem.set_code, soldItem.card_number, soldItem.grader, soldItem.grade, soldItem.cert_number]
        );
        
        let matchItem = null;
        for (const vItem of vaultRows) {
            if (parseFloat(vItem.purchase_price) === parseFloat(soldItem.purchase_price)) {
                matchItem = vItem; break;
            }
        }
        
        if (matchItem) {
            await pool.query('UPDATE inventory SET quantity = quantity + ? WHERE id = ?', [soldItem.quantity, matchItem.id]);
            await pool.query('DELETE FROM inventory WHERE id = ?', [id]);
        } else {
            await pool.query('UPDATE inventory SET status = "Vault", sold_price = 0, transaction_id = NULL, sold_at = NULL WHERE id = ?', [id]);
        }
        res.status(200).json({ message: 'Success' });
    } catch (error) { res.status(500).json({ error: 'Gagal batalkan' }); }
});

app.post('/api/inventory/bulk-import', async (req, res) => {
    let conn = null;
    try {
        conn = await pool.getConnection();
        const items = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            if (conn) conn.release();
            return res.status(400).json({ error: 'Data kosong' });
        }

        console.log('DEBUG IMPORT DATA [0]:', items[0] ? { name: items[0].name, purchase_price: items[0].purchase_price, market_price: items[0].market_price } : 'Empty');
        let insertedCount = 0;
        let updatedCount = 0;

        await conn.beginTransaction(); 

        for (const i of items) {
            const parsedQty = parseInt(i.quantity);
            const safeQty = (isNaN(parsedQty) || parsedQty < 1) ? 1 : parsedQty;
            
            const cleanNumber = (val) => {
                if (val === null || val === undefined || val === '') return 0;
                if (typeof val === 'number') return Math.round(val);
                const strVal = String(val).replace(/,/g, '').replace(/[^0-9.-]/g, ''); 
                const parsed = parseFloat(strVal);
                return isNaN(parsed) ? 0 : Math.round(parsed);
            };

            const safePP = cleanNumber(i.purchase_price);
            const safeMP = cleanNumber(i.market_price);

            const isHolo = parseInt(i.is_holo) || 0;
            const is1st = parseInt(i.is_first_edition) || 0;
            const sStr = (v, max = 250) => (v !== null && v !== undefined && v !== '') ? String(v).slice(0, max) : null;

            const name = sStr(i.name, 250) || 'Unnamed Card';
            const setName = sStr(i.set_name, 250) || '-';
            const lang = sStr(i.language, 100) || 'English';
            const cond = sStr(i.card_condition, 100) || 'NM';
            const grader = sStr(i.grader, 100);
            const grade = sStr(i.grade, 100);
            const certNum = sStr(i.cert_number, 100);
            const cardNum = sStr(i.card_number, 100);
            const setCode = sStr(i.set_code, 100);
            const cat = sStr(i.category, 100) || 'Single';

            const [existing] = await conn.query(
                `SELECT id FROM inventory WHERE status = 'Vault' AND name = ? AND set_name = ? AND language = ? AND card_condition = ? AND is_holo = ? AND is_first_edition = ? AND card_number <=> ? AND set_code <=> ? AND grader <=> ? AND grade <=> ? AND cert_number <=> ?`,
                [name, setName, lang, cond, isHolo, is1st, cardNum, setCode, grader, grade, certNum]
            );

            if (existing.length > 0) {
                await conn.query(
                    `UPDATE inventory SET quantity = quantity + ?, purchase_price = ?, market_price = ?, card_number = COALESCE(card_number, ?), set_code = COALESCE(set_code, ?) WHERE id = ?`,
                    [safeQty, safePP, safeMP, cardNum, setCode, existing[0].id]
                );
                updatedCount++;
            } else {
                await conn.query(
                    `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Vault')`,
                    [crypto.randomUUID(), name, cat, setName, setCode, cardNum, lang, safeQty, safePP, safeMP, i.notes || null, cond, isHolo, is1st, grader, grade, certNum]
                );
                insertedCount++;
            }
        }
        
        await conn.commit(); 
        res.status(201).json({ message: `Selesai! ${insertedCount} Kartu Baru. ${updatedCount} Kartu digabung.` });

    } catch (error) { 
        if (conn) await conn.rollback(); 
        console.error("🔥 ERROR MYSQL BULK IMPORT - AUTO ROLLBACK DILAKUKAN:", error);
        res.status(500).json({ error: error.message || 'Gagal import, seluruh data dibatalkan (Rollback)' }); 
    } finally {
        if (conn) conn.release(); 
    }
});

app.post('/api/inventory/bulk-replace', async (req, res) => {
    let conn = null;
    try {
        conn = await pool.getConnection();
        const items = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            if (conn) conn.release();
            return res.status(400).json({ error: 'Data kosong' });
        }

        let insertedCount = 0;
        await conn.beginTransaction(); 

        await conn.query(`DELETE FROM inventory WHERE status = 'Vault'`);

        for (const i of items) {
            const safeQty = parseInt(i.quantity) || 1;
            const safePP = typeof i.purchase_price === 'number' ? Math.round(i.purchase_price) : Math.round(parseFloat(String(i.purchase_price || 0).replace(/,/g, '').replace(/[^0-9.-]/g, '')) || 0);
            const safeMP = typeof i.market_price === 'number' ? Math.round(i.market_price) : Math.round(parseFloat(String(i.market_price || 0).replace(/,/g, '').replace(/[^0-9.-]/g, '')) || 0);
            const sStr = (v, max = 250) => (v !== null && v !== undefined && v !== '') ? String(v).slice(0, max) : null;

            await conn.query(
                `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Vault')`,
                [
                    crypto.randomUUID(), 
                    sStr(i.name, 250) || 'Unnamed', 
                    sStr(i.category, 100) || 'Single', 
                    sStr(i.set_name, 250) || '-', 
                    sStr(i.set_code, 100), 
                    sStr(i.card_number, 100), 
                    sStr(i.language, 100) || 'English', 
                    safeQty, safePP, safeMP, 
                    i.notes || null, 
                    sStr(i.card_condition, 100) || 'NM', 
                    i.is_holo || 0, 
                    i.is_first_edition || 0, 
                    sStr(i.grader, 100), 
                    sStr(i.grade, 100), 
                    sStr(i.cert_number, 100)
                ]
            );
            insertedCount++;
        }
        
        await conn.commit(); 
        res.status(201).json({ message: `Selesai! Seluruh Vault di-replace dengan ${insertedCount} kartu baru.` });
        
    } catch (error) { 
        if (conn) await conn.rollback(); 
        console.error("ERROR MYSQL BULK REPLACE:", error);
        res.status(500).json({ error: error.message || 'Gagal replace data' }); 
    } finally {
        if (conn) conn.release(); 
    }
});

app.put('/api/inventory/:id/qty', async (req, res) => {
    try {
        const { action } = req.body; 
        const [rows] = await pool.query('SELECT quantity FROM inventory WHERE id = ?', [req.params.id]);
        if(rows.length === 0) return res.status(404).json({error: 'Not found'});
        let newQty = rows[0].quantity;
        if (action === 'add') newQty++; else if (action === 'minus') newQty--;
        
        if (newQty < 0) return res.status(400).json({error: 'Minimal 0'}); 
        
        await pool.query('UPDATE inventory SET quantity = ? WHERE id = ?', [newQty, req.params.id]);
        res.status(200).json({ message: 'Updated' });
    } catch (error) { res.status(500).json({ error: 'Gagal' }); }
});

app.post('/api/inventory/bulk-delete', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Kosong' });
        await pool.query('DELETE FROM inventory WHERE id IN (?)', [ids]);
        res.status(200).json({ message: 'Sukses' });
    } catch (error) { res.status(500).json({ error: 'Gagal hapus' }); }
});

app.use('/api', (req, res) => {
    res.status(404).json({ error: `Endpoint API tidak ditemukan: ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
    console.error("Express Global Error:", err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: err.message || "Terjadi kesalahan internal pada server Node.js" });
});

app.listen(3000, () => console.log('Holovault Backend V2 (No Images) MENYALA di http://localhost:3000'));