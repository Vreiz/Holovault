const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const dir = './uploads/images';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

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
        if (queries.length === 0) return res.status(400).json({ error: 'Harus ada kata kunci' });
        
        const response = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queries.join(' '))}&orderBy=-set.releaseDate&pageSize=50`, {
            headers: { 'User-Agent': 'Holovault/1.0' }
        });
        
        if (!response.ok) throw new Error('API Reject');
        const data = await response.json();
        res.status(200).json(data.data || []);
    } catch (error) { res.status(500).json({ error: 'Gagal API' }); }
});

// API 2: Ambil Data
app.get('/api/inventory', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM inventory ORDER BY created_at DESC');
        res.status(200).json(rows);
    } catch (error) { res.status(500).json({ error: 'Gagal db' }); }
});

// API 3: Simpan
app.post('/api/inventory', multer().none(), async (req, res) => {
    try {
        const { name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, notes, card_condition, cert_number, external_image_url, grader, grade } = req.body;
        const id = crypto.randomUUID();
        await pool.query(
            `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, image_url, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Vault')`,
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

/* --- ALGORITMA PENJUALAN --- */
async function processSale(id, sell_qty, price_per_unit, trx_id) {
    const [rows] = await pool.query('SELECT * FROM inventory WHERE id = ?', [id]);
    if(rows.length === 0) return;
    const item = rows[0];
    const sq = parseInt(sell_qty);
    
    if(sq < item.quantity) {
        await pool.query('UPDATE inventory SET quantity = quantity - ? WHERE id = ?', [sq, id]);
        const newId = crypto.randomUUID();
        await pool.query(
            `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, image_url, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status, sold_price, transaction_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Sold', ?, ?)`,
            [newId, item.name, item.category, item.set_name, item.set_code, item.card_number, item.language, sq, item.purchase_price, item.market_price, item.image_url, item.notes, item.card_condition, item.is_holo, item.is_first_edition, item.grader, item.grade, item.cert_number, price_per_unit, trx_id]
        );
    } 
    else {
        await pool.query('UPDATE inventory SET status = "Sold", sold_price = ?, transaction_id = ? WHERE id = ?', [price_per_unit, trx_id, id]);
    }
}

// API 6: JUAL SINGLE
app.put('/api/inventory/:id/sell', async (req, res) => {
    try {
        const sell_qty = req.body.sell_qty || 1;
        const total_sold_price = req.body.sold_price || 0;
        const price_per_unit = total_sold_price / sell_qty;
        
        await processSale(req.params.id, sell_qty, price_per_unit, crypto.randomUUID());
        res.status(200).json({ message: 'Terjual!' });
    } catch (error) { res.status(500).json({ error: 'Gagal jual' }); }
});

// API 7: JUAL BORONGAN (BULK AUCTION)
app.post('/api/inventory/bulk-sell', async (req, res) => {
    try {
        const { items, total_price } = req.body; 
        if (!items || items.length === 0) return res.status(400).json({ error: 'Kosong' });

        const trx_id = crypto.randomUUID(); 
        const total_qty = items.reduce((sum, item) => sum + parseInt(item.sell_qty), 0);
        const price_per_unit = (parseFloat(total_price) || 0) / total_qty; 

        for(let i=0; i<items.length; i++) {
            await processSale(items[i].id, items[i].sell_qty, price_per_unit, trx_id);
        }
        res.status(200).json({ message: 'Borongan Sukses!' });
    } catch (error) { res.status(500).json({ error: 'Gagal borongan' }); }
});

// --- API 8: BATALKAN PENJUALAN (SMART AUTO-MERGE QUANTITY) ---
app.put('/api/inventory/:id/undo-sell', async (req, res) => {
    try {
        const id = req.params.id;
        
        // 1. Ambil data item yang mau dibatalkan
        const [rows] = await pool.query('SELECT * FROM inventory WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Item tidak ditemukan' });
        }
        const soldItem = rows[0];

        // 2. Ambil kandidat item sejenis yang ada di Vault
        const [vaultRows] = await pool.query(
            `SELECT * FROM inventory WHERE status = 'Vault' AND name = ? AND category = ? AND set_name = ?`,
            [soldItem.name, soldItem.category, soldItem.set_name]
        );

        // 3. Validasi pencocokan seluruh spesifikasi fisik kartu
        let matchItem = null;
        for (const vaultItem of vaultRows) {
            if (
                vaultItem.set_code === soldItem.set_code &&
                vaultItem.card_number === soldItem.card_number &&
                vaultItem.language === soldItem.language &&
                vaultItem.card_condition === soldItem.card_condition &&
                vaultItem.is_holo === soldItem.is_holo &&
                vaultItem.is_first_edition === soldItem.is_first_edition &&
                vaultItem.grader === soldItem.grader &&
                vaultItem.grade === soldItem.grade &&
                vaultItem.cert_number === soldItem.cert_number &&
                parseFloat(vaultItem.purchase_price) === parseFloat(soldItem.purchase_price)
            ) {
                matchItem = vaultItem;
                break;
            }
        }

        if (matchItem) {
            // JIKA KETEMU INDUKNYA: Tambahkan kuantitas ke baris induk, lalu hapus baris pecahan ini
            await pool.query(
                'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
                [soldItem.quantity, matchItem.id]
            );
            await pool.query('DELETE FROM inventory WHERE id = ?', [id]);
            console.log(`[Merge Success] Kuantitas dikembalikan ke item induk ID: ${matchItem.id}`);
        } else {
            // JIKA INDUKNYA SUDAH DIHAPUS USER: Kembalikan baris ini sebagai entri Vault baru
            await pool.query(
                'UPDATE inventory SET status = "Vault", sold_price = 0, transaction_id = NULL WHERE id = ?',
                [id]
            );
            console.log(`[Return Success] Item dikembalikan sebagai entri mandiri baru.`);
        }

        res.status(200).json({ message: 'Penjualan dibatalkan, quantity berhasil disatukan!' });
    } catch (error) {
        console.error('Undo Sell Error:', error);
        res.status(500).json({ error: 'Gagal membatalkan penjualan' });
    }
});

app.listen(3000, () => console.log('Backend MENYALA di http://localhost:3000'));