const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const pool = mysql.createPool({
    host: 'localhost', user: 'root', password: '', database: 'pokemon_db'
});

// API 1: Pencarian
app.get('/api/search-card', async (req, res) => {
    try {
        const { name, set } = req.query;
        let queries = [];
        if (name) queries.push(`name:"*${name}*"`);
        if (set) queries.push(`set.name:"*${set}*"`);
        if (queries.length === 0) return res.status(400).json({ error: 'Query kosong' });
        
        const response = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queries.join(' '))}&orderBy=-set.releaseDate&pageSize=30`, { headers: { 'User-Agent': 'Holovault/1.0' } });
        const data = await response.json();
        res.status(200).json(data.data || []);
    } catch (error) { res.status(500).json({ error: 'Gagal API' }); }
});

// API 2: Ambil Data
app.get('/api/inventory', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM inventory ORDER BY created_at DESC');
        res.status(200).json(rows);
    } catch (error) { res.status(500).json({ error: 'Gagal database' }); }
});

// API 3: Simpan Manual
app.post('/api/inventory', multer().none(), async (req, res) => {
    try {
        const { name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, notes, card_condition, cert_number, external_image_url, grader, grade } = req.body;
        const id = crypto.randomUUID();
        await pool.query(
            `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, image_url, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Vault')`,
            [id, name, category, set_name || '-', set_code || null, card_number || null, language || 'English', quantity || 1, purchase_price || 0, market_price || 0, external_image_url || null, notes || null, card_condition || null, req.body.is_holo?1:0, req.body.is_first_edition?1:0, grader || null, grade || null, cert_number || null]
        );
        res.status(201).json({ message: 'Saved' });
    } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

// API 4: Update
app.put('/api/inventory/:id', multer().none(), async (req, res) => {
    try {
        const { name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, notes, card_condition, cert_number, external_image_url, grader, grade } = req.body;
        await pool.query(
            `UPDATE inventory SET name=?, category=?, set_name=?, set_code=?, card_number=?, language=?, quantity=?, purchase_price=?, market_price=?, image_url=?, notes=?, card_condition=?, is_holo=?, is_first_edition=?, grader=?, grade=?, cert_number=? WHERE id=?`,
            [name, category, set_name || '-', set_code || null, card_number || null, language || 'English', quantity || 1, purchase_price || 0, market_price || 0, external_image_url || null, notes || null, card_condition || null, req.body.is_holo?1:0, req.body.is_first_edition?1:0, grader || null, grade || null, cert_number || null, req.params.id]
        );
        res.status(200).json({ message: 'Updated' });
    } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

// API 5: Delete
app.delete('/api/inventory/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM inventory WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Deleted' });
    } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

// Algoritme Pecah Penjualan
async function processSale(id, sell_qty, price_per_unit, trx_id) {
    const [rows] = await pool.query('SELECT * FROM inventory WHERE id = ?', [id]);
    if(rows.length === 0) return;
    const item = rows[0]; const sq = parseInt(sell_qty);
    if(sq < item.quantity) {
        await pool.query('UPDATE inventory SET quantity = quantity - ? WHERE id = ?', [sq, id]);
        const newId = crypto.randomUUID();
        await pool.query(
            `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, image_url, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status, sold_price, transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Sold', ?, ?)`,
            [newId, item.name, item.category, item.set_name, item.set_code, item.card_number, item.language, sq, item.purchase_price, item.market_price, item.image_url, item.notes, item.card_condition, item.is_holo, item.is_first_edition, item.grader, item.grade, item.cert_number, price_per_unit, trx_id]
        );
    } else {
        await pool.query('UPDATE inventory SET status = "Sold", sold_price = ?, transaction_id = ? WHERE id = ?', [price_per_unit, trx_id, id]);
    }
}

// API 6: Jual Single
app.put('/api/inventory/:id/sell', async (req, res) => {
    try {
        await processSale(req.params.id, req.body.sell_qty || 1, (req.body.sold_price || 0) / (req.body.sell_qty || 1), crypto.randomUUID());
        res.status(200).json({ message: 'Sold' });
    } catch (error) { res.status(500).json({ error: 'Gagal' }); }
});

// API 7: Jual Borongan
app.post('/api/inventory/bulk-sell', async (req, res) => {
    try {
        const { items, total_price } = req.body; 
        const trx_id = crypto.randomUUID(); 
        const total_qty = items.reduce((sum, i) => sum + parseInt(i.sell_qty), 0);
        const price_per_unit = total_price / total_qty;
        for(let i=0; i<items.length; i++) { await processSale(items[i].id, items[i].sell_qty, price_per_unit, trx_id); }
        res.status(200).json({ message: 'Success' });
    } catch (error) { res.status(500).json({ error: 'Gagal' }); }
});

// API 8: Undo Jual
app.put('/api/inventory/:id/undo-sell', async (req, res) => {
    try {
        const id = req.params.id;
        const [rows] = await pool.query('SELECT * FROM inventory WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const soldItem = rows[0];

        const [vaultRows] = await pool.query(`SELECT * FROM inventory WHERE status = 'Vault' AND name = ? AND category = ? AND set_name = ?`, [soldItem.name, soldItem.category, soldItem.set_name]);
        let matchItem = null;
        for (const vItem of vaultRows) {
            if (vItem.set_code === soldItem.set_code && vItem.card_number === soldItem.card_number && vItem.language === soldItem.language && vItem.card_condition === soldItem.card_condition && vItem.is_holo === soldItem.is_holo && vItem.is_first_edition === soldItem.is_first_edition && vItem.grader === soldItem.grader && vItem.grade === soldItem.grade && vItem.cert_number === soldItem.cert_number && parseFloat(vItem.purchase_price) === parseFloat(soldItem.purchase_price)) {
                matchItem = vItem; break;
            }
        }
        if (matchItem) {
            await pool.query('UPDATE inventory SET quantity = quantity + ? WHERE id = ?', [soldItem.quantity, matchItem.id]);
            await pool.query('DELETE FROM inventory WHERE id = ?', [id]);
        } else {
            await pool.query('UPDATE inventory SET status = "Vault", sold_price = 0, transaction_id = NULL WHERE id = ?', [id]);
        }
        res.status(200).json({ message: 'Success' });
    } catch (error) { res.status(500).json({ error: 'Gagal' }); }
});

// API 9: Bulk Import
app.post('/api/inventory/bulk-import', async (req, res) => {
    try {
        const items = req.body;
        if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Data kosong' });

        const values = items.map(i => [
            crypto.randomUUID(), i.name || 'Unnamed Card', i.category || 'Single', i.set_name || '-', i.set_code || null, i.card_number || null, i.language || 'English', parseInt(i.quantity) || 1, parseFloat(i.purchase_price) || 0.00, parseFloat(i.market_price) || 0.00, i.image_url || null, i.notes || null, i.card_condition || 'NM', parseInt(i.is_holo) || 0, parseInt(i.is_first_edition) || 0, i.grader || null, i.grade || null, i.cert_number || null, 'Vault'
        ]);
        await pool.query(`INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, image_url, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status) VALUES ?`, [values]);
        res.status(201).json({ message: 'Bulk import berhasil!' });
    } catch (error) { res.status(500).json({ error: 'Gagal melakukan query massal' }); }
});

// --- API 10: QUICK QTY ADJUST (BARU) ---
app.put('/api/inventory/:id/qty', async (req, res) => {
    try {
        const { action } = req.body; 
        const [rows] = await pool.query('SELECT quantity FROM inventory WHERE id = ?', [req.params.id]);
        if(rows.length === 0) return res.status(404).json({error: 'Not found'});
        
        let newQty = rows[0].quantity;
        if (action === 'add') newQty++;
        else if (action === 'minus') newQty--;
        
        if (newQty < 1) return res.status(400).json({error: 'Kuantitas minimal adalah 1'});
        
        await pool.query('UPDATE inventory SET quantity = ? WHERE id = ?', [newQty, req.params.id]);
        res.status(200).json({ message: 'Quantity updated' });
    } catch (error) { res.status(500).json({ error: 'Gagal update kuantitas' }); }
});

app.listen(3000, () => console.log('Backend MENYALA di http://localhost:3000'));