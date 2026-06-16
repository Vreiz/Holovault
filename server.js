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

// Buat folder gambar otomatis
const dir = './uploads/images';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// Koneksi Database
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'pokemon_db'
});

// --- API 1: Pencarian Kartu Canggih ---
app.get('/api/search-card', async (req, res) => {
    try {
        const { name, set } = req.query;
        let queries = [];
        
        // Logika dinamis: Bisa pakai Nama saja, Set saja, atau Keduanya!
        if (name) queries.push(`name:"*${name}*"`);
        if (set) queries.push(`set.name:"*${set}*"`);
        
        // Tolak jika dua-duanya kosong
        if (queries.length === 0) {
            return res.status(400).json({ error: 'Harus ada kata kunci pencarian' });
        }
        
        const stringQuery = queries.join(' ');
        const queryAman = encodeURIComponent(stringQuery);
        
        const response = await fetch(`https://api.pokemontcg.io/v2/cards?q=${queryAman}&orderBy=-set.releaseDate&pageSize=50`, {
            headers: { 'User-Agent': 'Holovault-App/1.0', 'Accept': 'application/json' }
        });
        
        if (!response.ok) throw new Error('Ditolak oleh Server API');
        
        const data = await response.json();
        res.status(200).json(data.data || []);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Gagal mencari dari server pusat' });
    }
});

// --- API 2: Ambil Data Inventory ---
app.get('/api/inventory', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM inventory ORDER BY created_at DESC');
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil data database' });
    }
});

// --- API 3: Simpan Kartu Baru (Create) ---
app.post('/api/inventory', multer().none(), async (req, res) => {
    try {
        const { 
            name, category, set_name, set_code, card_number, language, 
            quantity, purchase_price, market_price, notes, card_condition, 
            cert_number, external_image_url, grader, grade 
        } = req.body;
        
        const id = crypto.randomUUID();
        const is_holo = req.body.is_holo ? 1 : 0;
        const is_first_edition = req.body.is_first_edition ? 1 : 0;

        await pool.query(
            `INSERT INTO inventory (
                id, name, category, set_name, set_code, card_number, language, 
                quantity, purchase_price, market_price, image_url, notes, 
                card_condition, is_holo, is_first_edition, grader, grade, cert_number
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, name, category, set_name || '-', set_code || null, card_number || null, language || 'English', 
                quantity || 1, purchase_price || 0, market_price || 0, external_image_url || null, notes || null, 
                card_condition || null, is_holo, is_first_edition, grader || null, grade || null, cert_number || null
            ]
        );

        res.status(201).json({ message: 'Kartu berhasil diamankan di Holovault!' });
    } catch (error) {
        console.error('Simpan Error:', error);
        res.status(500).json({ error: 'Gagal menyimpan ke database' });
    }
});

// --- API 4: Update Kartu (Edit) ---
app.put('/api/inventory/:id', multer().none(), async (req, res) => {
    try {
        const id = req.params.id;
        const { 
            name, category, set_name, set_code, card_number, language, 
            quantity, purchase_price, market_price, notes, card_condition, 
            cert_number, external_image_url, grader, grade 
        } = req.body;
        
        const is_holo = req.body.is_holo ? 1 : 0;
        const is_first_edition = req.body.is_first_edition ? 1 : 0;

        await pool.query(
            `UPDATE inventory SET 
                name=?, category=?, set_name=?, set_code=?, card_number=?, language=?, 
                quantity=?, purchase_price=?, market_price=?, image_url=?, notes=?, 
                card_condition=?, is_holo=?, is_first_edition=?, grader=?, grade=?, cert_number=?
             WHERE id=?`,
            [
                name, category, set_name || '-', set_code || null, card_number || null, language || 'English', 
                quantity || 1, purchase_price || 0, market_price || 0, external_image_url || null, notes || null, 
                card_condition || null, is_holo, is_first_edition, grader || null, grade || null, cert_number || null, id
            ]
        );
        res.status(200).json({ message: 'Item berhasil diupdate!' });
    } catch (error) {
        console.error('Update Error:', error);
        res.status(500).json({ error: 'Gagal mengupdate database' });
    }
});

// --- API 5: Hapus Kartu (Delete) ---
app.delete('/api/inventory/:id', async (req, res) => {
    try {
        console.log("Menerima perintah hapus untuk ID:", req.params.id);
        await pool.query('DELETE FROM inventory WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Item berhasil dihapus!' });
    } catch (error) {
        console.error('Delete Error:', error);
        res.status(500).json({ error: 'Gagal menghapus dari database' });
    }
});

app.listen(3000, () => {
    console.log('Holovault Backend MENYALA di http://localhost:3000');
});