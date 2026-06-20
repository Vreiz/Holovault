const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Auto-create folder uploads jika belum ada
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// Membuka akses publik ke folder uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Konfigurasi Penyimpanan Gambar Lokal
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        // Nama file diacak agar tidak ada yang bentrok
        cb(null, crypto.randomUUID() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const pool = mysql.createPool({
    host: 'localhost', user: 'root', password: '', database: 'pokemon_db'
});

app.get('/api/search-card', async (req, res) => {
    try {
        const { name, set } = req.query;
        let queries = [];
        
        if (name && name.trim() !== '') {
            const nameParts = name.trim().split(/\s+/);
            nameParts.forEach(part => queries.push(`name:*${part}*`));
        }
        
        if (set && set.trim() !== '') {
            const setParts = set.trim().split(/\s+/);
            setParts.forEach(part => queries.push(`set.name:*${part}*`));
        }
        
        if (queries.length === 0) return res.status(400).json({ error: 'Query kosong' });
        
        // Memakai pageSize 250 untuk tarikan maksimal
        const apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queries.join(' '))}&orderBy=-set.releaseDate&pageSize=250`;
        
        const response = await fetch(apiUrl, { headers: { 'User-Agent': 'Holovault/1.0' } });
        const data = await response.json();
        res.status(200).json(data.data || []);
    } catch (error) { 
        res.status(500).json({ error: 'Gagal API Pusat' }); 
    }
}); 

app.get('/api/inventory', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM inventory ORDER BY created_at DESC');
        res.status(200).json(rows);
    } catch (error) { res.status(500).json({ error: 'Gagal database' }); }
});

// API 3: SIMPAN BARU (MENDUKUNG UPLOAD FILE)
app.post('/api/inventory', upload.single('image_file'), async (req, res) => {
    try {
        const { name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, notes, card_condition, cert_number, external_image_url, grader, grade } = req.body;
        
        let finalImageUrl = external_image_url || null;
        if (req.file) {
            finalImageUrl = `/uploads/${req.file.filename}`;
        }

        const id = crypto.randomUUID();
        await pool.query(
            `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, image_url, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Vault')`,
            [id, name, category, set_name || '-', set_code || null, card_number || null, language || 'English', quantity || 1, purchase_price || 0, market_price || 0, finalImageUrl, notes || null, card_condition || null, req.body.is_holo?1:0, req.body.is_first_edition?1:0, grader || null, grade || null, cert_number || null]
        );
        res.status(201).json({ message: 'Saved' });
    } catch (error) { res.status(500).json({ error: 'Gagal simpan' }); }
});

// API 4: UPDATE DATA (MENDUKUNG UPLOAD FILE)
app.put('/api/inventory/:id', upload.single('image_file'), async (req, res) => {
    try {
        const { name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, notes, card_condition, cert_number, external_image_url, grader, grade } = req.body;
        
        let finalImageUrl = external_image_url || null;
        if (req.file) {
            finalImageUrl = `/uploads/${req.file.filename}`;
        }

        await pool.query(
            `UPDATE inventory SET name=?, category=?, set_name=?, set_code=?, card_number=?, language=?, quantity=?, purchase_price=?, market_price=?, image_url=?, notes=?, card_condition=?, is_holo=?, is_first_edition=?, grader=?, grade=?, cert_number=? WHERE id=?`,
            [name, category, set_name || '-', set_code || null, card_number || null, language || 'English', quantity || 1, purchase_price || 0, market_price || 0, finalImageUrl, notes || null, card_condition || null, req.body.is_holo?1:0, req.body.is_first_edition?1:0, grader || null, grade || null, cert_number || null, req.params.id]
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

// --- LOGIKA PENJUALAN BARU (ANTI-CRASH & TIDAK MENGHILANGKAN ENTRY) ---
async function processSale(id, sell_qty, price_per_unit, trx_id) {
    const [rows] = await pool.query('SELECT * FROM inventory WHERE id = ?', [id]);
    if(rows.length === 0) return;
    const item = rows[0]; const sq = parseInt(sell_qty);
    
    // 1. Kurangi kuantitas di Vault
    await pool.query('UPDATE inventory SET quantity = quantity - ? WHERE id = ?', [sq, id]);
    
    // 2. Buat duplikat struk di Tab Transaksi dengan "|| null" Fallback
    const newId = crypto.randomUUID();
    await pool.query(
        `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, image_url, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status, sold_price, transaction_id, sold_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Sold', ?, ?, NOW())`,
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
            item.image_url || null, 
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

// 🔥 API JUAL SATUAN (SEBELUMNYA HILANG)
app.put('/api/inventory/:id/sell', async (req, res) => {
    try {
        await processSale(req.params.id, req.body.sell_qty || 1, (req.body.sold_price || 0) / (req.body.sell_qty || 1), crypto.randomUUID());
        res.status(200).json({ message: 'Sold' });
    } catch (error) { 
        console.error("ERROR JUAL SINGLE:", error);
        res.status(500).json({ error: error.message || 'Gagal jual satuan' }); 
    }
});

// API JUAL BORONGAN
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

        // MENCARI PASANGAN VAULT DENGAN SANGAT KETAT
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

// --- PERBAIKAN: DETEKSI DUPLIKAT KETAT & FIX BUG EXCEL 7 DIGIT ---
app.post('/api/inventory/bulk-import', async (req, res) => {
    try {
        const items = req.body;
        if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Data kosong' });

        let insertedCount = 0;
        let updatedCount = 0;

        for (const i of items) {
            const parsedQty = parseInt(i.quantity);
            const safeQty = (isNaN(parsedQty) || parsedQty < 1) ? 1 : parsedQty;
            
            // Fungsi pembersih angka ajaib untuk Excel
            const cleanNumber = (val) => {
                if (val === null || val === undefined || val === '') return 0;
                const strVal = String(val).replace(/[^0-9]/g, ''); 
                const parsed = parseInt(strVal, 10);
                return isNaN(parsed) ? 0 : parsed;
            };

            const safePP = cleanNumber(i.purchase_price);
            const safeMP = cleanNumber(i.market_price);

            const isHolo = parseInt(i.is_holo) || 0;
            const is1st = parseInt(i.is_first_edition) || 0;
            const name = i.name || 'Unnamed Card';
            const setName = i.set_name || '-';
            const lang = i.language || 'English';
            const cond = i.card_condition || 'NM';

            const [existing] = await pool.query(
                `SELECT id FROM inventory WHERE status = 'Vault' AND name = ? AND set_name = ? AND language = ? AND card_condition = ? AND is_holo = ? AND is_first_edition = ? AND set_code <=> ? AND card_number <=> ? AND grader <=> ? AND grade <=> ? AND cert_number <=> ?`,
                [name, setName, lang, cond, isHolo, is1st, i.set_code || null, i.card_number || null, i.grader || null, i.grade || null, i.cert_number || null]
            );

            if (existing.length > 0) {
                await pool.query(
                    `UPDATE inventory SET quantity = quantity + ?, purchase_price = ?, market_price = ?, image_url = COALESCE(?, image_url) WHERE id = ?`,
                    [safeQty, safePP, safeMP, i.image_url || null, existing[0].id]
                );
                updatedCount++;
            } else {
                await pool.query(
                    `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, image_url, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Vault')`,
                    [crypto.randomUUID(), name, i.category || 'Single', setName, i.set_code || null, i.card_number || null, lang, safeQty, safePP, safeMP, i.image_url || null, i.notes || null, cond, isHolo, is1st, i.grader || null, i.grade || null, i.cert_number || null]
                );
                insertedCount++;
            }
        }
        res.status(201).json({ message: `Selesai! ${insertedCount} Kartu Baru. ${updatedCount} Kartu digabung.` });
    } catch (error) { 
        console.error("🔥 ERROR MYSQL BULK IMPORT:", error);
        res.status(500).json({ error: error.message || 'Gagal menyimpan ke MySQL' }); 
    }
});

// IZINKAN QTY MANUAL TURUN HINGGA 0 (Kode ganda sudah dihapus)
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

app.listen(3000, () => console.log('Holovault Backend V9.3 MENYALA di http://localhost:3000'));