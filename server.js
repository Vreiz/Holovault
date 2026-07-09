const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
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
// Membuka akses agar Node.js menampilkan file index.html dan CSS kamu
app.use(express.static(__dirname));
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

// Otomatis sesuaikan ukuran VARCHAR kolom pada tabel inventory agar tidak terjadi error "Data too long for column" saat import/replace
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
        console.log("✅ Skema database diperbarui (kolom VARCHAR diperluas menjadi 255 karakter).");
    } catch (e) {
        console.log("Catatan auto-check skema:", e.message);
    }
}
ensureSchemaLengths();
// =====================================================================
// API 0: AMBIL SEMUA DATA (RUTE YANG TIDAK SENGAJA TERHAPUS)
// =====================================================================
app.get('/api/inventory', async (req, res) => {
    try {
        let rows;
        try {
            [rows] = await pool.query('SELECT * FROM inventory');
        } catch (retryErr) {
            if (retryErr.code === 'ECONNRESET' || retryErr.code === 'PROTOCOL_CONNECTION_LOST') {
                console.log("🔄 Re-querying TiDB setelah ECONNRESET...");
                [rows] = await pool.query('SELECT * FROM inventory');
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
// =====================================================================
// API 1: PENCARIAN KARTU GLOBAL (ENGLISH) - Menggunakan pokemontcg.io
// =====================================================================
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


// =====================================================================
// API 2: CRAWLER KARTU JEPANG (JP) - Menggunakan Axios & Cheerio
// =====================================================================
// =====================================================================
// API 2: CRAWLER KARTU JEPANG (JP) - ANTI REDIRECT
// =====================================================================
async function crawlPokellectorJP(query) {
    try {
        if (!query) return [];
        const baseUrl = `https://jp.pokellector.com/search?criteria=${encodeURIComponent(query)}`;
        let hasilKartu = [];

        const fetchPage = async (pageUrl) => {
            const response = await axios.get(pageUrl, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
                    'Cookie': 'PokemonDatabaseLanguage=jp; locale=ja; region=jp;'
                },
                timeout: 10000
            });
            const $ = cheerio.load(response.data);
            $('.cardresult').each((index, element) => {
                const gambarUrl = $(element).find('img.card').attr('data-src') || $(element).find('img.card').attr('src');
                if (!gambarUrl) return;

                let namaKartu = $(element).find('.detail .name').text().trim() || query;
                let rawSet = $(element).find('.detail .set').text().trim() || '';
                let setName = '';
                let cardNumber = '';
                
                if (rawSet.includes('#')) {
                    let parts = rawSet.split('#');
                    setName = parts[0].trim();
                    cardNumber = parts[1].trim();
                } else {
                    setName = rawSet;
                }

                hasilKartu.push({
                    name: namaKartu,
                    images: { small: gambarUrl },
                    set: { name: setName },
                    number: cardNumber
                });
            });
            return $;
        };

        const $firstPage = await fetchPage(baseUrl);

        let maxPage = 1;
        $firstPage('.pagination a').each((i, el) => {
            let num = parseInt($(el).text().trim());
            if (!isNaN(num) && num > maxPage) maxPage = num;
        });
        if (maxPage > 5) maxPage = 5;

        const pagePromises = [];
        for (let i = 2; i <= maxPage; i++) {
            pagePromises.push(fetchPage(`${baseUrl}&page=${i}`));
        }
        await Promise.all(pagePromises);
        
        if (hasilKartu.length === 0) {
            const singleImage = $firstPage('#pokeball-container img, .card-image img').attr('src');
            if (singleImage) {
                hasilKartu.push({ name: query, images: { small: singleImage }, set: { name: '' }, number: '' });
            }
        }
        return hasilKartu;
    } catch (error) {
        console.error("Crawler JP Error:", error.response ? error.response.status : error.message);
        return [];
    }
}

app.get('/api/search-jp', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) return res.status(400).json({ error: 'Query kosong' });

        const hasilKartu = await crawlPokellectorJP(query);
        res.status(200).json(hasilKartu);
    } catch (error) {
        res.status(500).json({ error: 'Crawler gagal menembus target' });
    }
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

// =====================================================================
// SMART MATCHER: Cari kartu yang paling cocok dari hasil API
// =====================================================================
function findBestMatch(searchResults, targetName, targetSetName, targetNumber) {
    if (!searchResults || searchResults.length === 0) return null;

    // Normalisasi target
    const tName = (targetName || '').trim().toLowerCase();
    const tSet = (targetSetName || '').trim().toLowerCase();
    // Ambil nomor kartu tanpa leading zero dan tanpa bagian "/xxx"
    const tNum = (targetNumber || '').split('/')[0].replace(/^0+/, '').toLowerCase();

    let bestCard = null;
    let bestScore = 0; // 🔥 HARUS > 0 AGAR TIDAK ASAL PILIH KARTU YANG SCORE NYA 0!

    for (const card of searchResults) {
        if (!card.images || !card.images.small) continue;
        let score = 0;

        const cName = (card.name || '').trim().toLowerCase();
        const cSet = (card.set && card.set.name ? card.set.name : '').trim().toLowerCase();
        const cNum = (card.number || '').split('/')[0].replace(/^0+/, '').toLowerCase();

        // +50 poin: Nama kartu PERSIS sama
        if (cName === tName) score += 50;
        // +10 poin: Nama mengandung target (partial match) atau target mengandung nama
        else if (cName.includes(tName) || tName.includes(cName)) score += 10;

        // +30 poin: Set name cocok
        if (tSet && cSet && (cSet === tSet || cSet.includes(tSet) || tSet.includes(cSet))) {
            score += 30;
        } else if (tSet && cSet && tSet !== '-' && cSet !== '-') {
            // Jika set name disediakan oleh user, dan ternyata set name dari API BEDA,
            // kita beri penalti agar tidak mendahului kartu dengan set yang benar.
            score -= 20;
        }

        // +40 poin: Nomor kartu PERSIS cocok (ini yang paling penting untuk membedakan variant)
        if (tNum && cNum && cNum === tNum) score += 40;

        if (score > bestScore) {
            bestScore = score;
            bestCard = card;
        }
    }

    return bestCard;
}

// =====================================================================
// CRAWLER POKELLECTOR ENGLISH - Fallback jika pokemontcg.io tidak punya
// =====================================================================
async function crawlPokellectorEN(cardName, setName) {
    try {
        const query = cardName + (setName && setName !== '-' ? ' ' + setName : '');
        const url = `https://www.pokellector.com/search?criteria=${encodeURIComponent(query)}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html'
            },
            timeout: 10000
        });
        const $ = cheerio.load(response.data);
        let results = [];
        $('.cardresult').each((i, el) => {
            const imgUrl = $(el).find('img.card').attr('data-src') || $(el).find('img.card').attr('src');
            // Filter out placeholder images
            if (!imgUrl || imgUrl.includes('card-placeholder')) return;
            const name = $(el).find('.detail .name').text().trim();
            let rawSet = $(el).find('.detail .set').text().trim();
            let sName = '', cardNum = '';
            if (rawSet.includes('#')) {
                let parts = rawSet.split('#');
                sName = parts[0].trim();
                cardNum = parts[1].trim();
            } else {
                sName = rawSet;
            }
            results.push({ name, images: { small: imgUrl }, set: { name: sName }, number: cardNum });
        });
        return results;
    } catch (e) {
        console.log(`[POKELLECTOR-EN] Crawl failed: ${e.message}`);
        return [];
    }
}

// =====================================================================
// HELPER: PENCARI GAMBAR MULTI-SOURCE (EN, JP, POKELLECTOR EN/JP)
// =====================================================================
async function fetchImageForCard(card) {
    const cleanName = (card.name || '').replace(/\s*\(.*?\)\s*/g, '').trim();
    const cleanNum = card.card_number ? card.card_number.split('/')[0].replace(/^0+/, '') : '';
    // Base name tanpa suffix V/VMAX/VSTAR/ex/GX/EX dll (untuk Pokellector JP yang sering gagal dengan suffix)
    const baseName = (card.name || '').replace(/\s+(V|VMAX|VSTAR|ex|EX|GX|MEGA|V-UNION)\s*$/i, '').trim();

    let bestMatch = null;

    if (card.language === 'Japanese') {
        // Step 1 JP: Pokellector JP (dengan Set Name)
        let query = card.name + (card.set_name && card.set_name !== '-' ? " " + card.set_name : "");
        try {
            const res = await crawlPokellectorJP(query);
            bestMatch = findBestMatch(res || [], card.name, card.set_name, card.card_number);
        } catch(e) {}

        // Step 2 JP: Jika belum ketemu, Pokellector JP (nama kartu saja tanpa Set Name)
        if (!bestMatch) {
            try {
                const res = await crawlPokellectorJP(card.name);
                bestMatch = findBestMatch(res || [], card.name, card.set_name, card.card_number);
            } catch(e) {}
        }

        // Step 2.5 JP: Jika masih belum ketemu DAN nama punya suffix (V/VMAX/ex dll),
        // coba Pokellector JP dengan base name saja (misal: "Zacian" bukan "Zacian V")
        // Pokellector JP sering mengembalikan 0 result untuk "Zacian V" tapi 20+ untuk "Zacian"
        if (!bestMatch && baseName !== card.name) {
            console.log(`[FETCH-IMAGE] JP search gagal untuk "${card.name}", coba base name "${baseName}"...`);
            try {
                const res = await crawlPokellectorJP(baseName);
                bestMatch = findBestMatch(res || [], card.name, card.set_name, card.card_number);
            } catch(e) {}
        }

        // Step 3 JP: Jika masih belum ketemu, coba Pokellector EN (karena Pokellector EN juga punya set Jepang seperti Shiny Star V!)
        if (!bestMatch) {
            let pokResults = await crawlPokellectorEN(card.name, card.set_name);
            bestMatch = findBestMatch(pokResults, card.name, card.set_name, card.card_number);
            if (!bestMatch && card.set_name && card.set_name !== '-') {
                pokResults = await crawlPokellectorEN(card.name, '');
                bestMatch = findBestMatch(pokResults, card.name, card.set_name, card.card_number);
            }
        }

        // Step 4 JP: Fallback terakhir ke api.pokemontcg.io (agar tetap mendapatkan artwork asli Pokémon meskipun set/bahasa berbeda!)
        if (!bestMatch) {
            console.log(`[FETCH-IMAGE] Pokellector gagal untuk ${card.name} (JP), coba api.pokemontcg.io...`);
            try {
                let apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(`name:"${card.name}"`)}&pageSize=20`;
                let response = await fetch(apiUrl, { headers: { 'User-Agent': 'Holovault/1.0' } });
                let data = await response.json();
                bestMatch = findBestMatch(data.data || [], card.name, card.set_name, card.card_number);
            } catch(e) {}
        }

        // Step 4.5 JP: Jika API gagal juga dengan nama lengkap, coba base name di pokemontcg.io
        if (!bestMatch && baseName !== card.name) {
            try {
                let apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(`name:"${baseName}"`)}&pageSize=20`;
                let response = await fetch(apiUrl, { headers: { 'User-Agent': 'Holovault/1.0' } });
                let data = await response.json();
                bestMatch = findBestMatch(data.data || [], card.name, card.set_name, card.card_number);
            } catch(e) {}
        }
    } else {
        // EN / Universal: Step 1 exact query ke pokemontcg.io
        try {
            let queries = [`name:"${card.name}"`];
            if (card.set_name && card.set_name !== '-') queries.push(`set.name:"${card.set_name}"`);
            if (cleanNum) queries.push(`number:${cleanNum}`);

            let apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queries.join(' '))}&pageSize=20`;
            let response = await fetch(apiUrl, { headers: { 'User-Agent': 'Holovault/1.0' } });
            let data = await response.json();
            bestMatch = findBestMatch(data.data || [], card.name, card.set_name, card.card_number);

            // Step 2 EN: Jika nama asli gagal dan ada parenthetical, coba dengan cleanName
            if (!bestMatch && cleanName !== card.name) {
                queries = [`name:"${cleanName}"`];
                if (card.set_name && card.set_name !== '-') queries.push(`set.name:"${card.set_name}"`);
                if (cleanNum) queries.push(`number:${cleanNum}`);
                apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queries.join(' '))}&pageSize=20`;
                response = await fetch(apiUrl, { headers: { 'User-Agent': 'Holovault/1.0' } });
                data = await response.json();
                bestMatch = findBestMatch(data.data || [], card.name, card.set_name, card.card_number);
            }

            // Step 3 EN: Jika masih gagal, coba tanpa set name (broadest search di pokemontcg.io)
            if (!bestMatch && card.set_name && card.set_name !== '-') {
                const fbUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(`name:"${card.name}"`)}&pageSize=20`;
                const fbResponse = await fetch(fbUrl, { headers: { 'User-Agent': 'Holovault/1.0' } });
                const fbData = await fbResponse.json();
                bestMatch = findBestMatch(fbData.data || [], card.name, card.set_name, card.card_number);
            }
        } catch(e) {}

        // Step 4 EN: Fallback ke Pokellector EN
        if (!bestMatch) {
            console.log(`[FETCH-IMAGE] pokemontcg.io gagal untuk ${card.name}, coba Pokellector EN...`);
            let pokResults = await crawlPokellectorEN(card.name, card.set_name);
            bestMatch = findBestMatch(pokResults, card.name, card.set_name, card.card_number);
            if (!bestMatch && card.set_name && card.set_name !== '-') {
                pokResults = await crawlPokellectorEN(card.name, '');
                bestMatch = findBestMatch(pokResults, card.name, card.set_name, card.card_number);
            }
        }

        // Step 5 EN: Fallback ke Pokellector JP (PENTING untuk kasus kartu set Jepang seperti Inferno X yang salah diinput dengan bahasa English di database!)
        if (!bestMatch) {
            console.log(`[FETCH-IMAGE] Pokellector EN gagal untuk ${card.name}, coba Pokellector JP...`);
            try {
                const res = await crawlPokellectorJP(card.name);
                bestMatch = findBestMatch(res || [], card.name, card.set_name, card.card_number);
            } catch(e) {}
        }

        // Step 5.5 EN: Jika Pokellector JP juga gagal, coba base name di JP (tanpa suffix V/VMAX/ex dll)
        if (!bestMatch && baseName !== card.name) {
            console.log(`[FETCH-IMAGE] Coba Pokellector JP dengan base name "${baseName}"...`);
            try {
                const res = await crawlPokellectorJP(baseName);
                bestMatch = findBestMatch(res || [], card.name, card.set_name, card.card_number);
            } catch(e) {}
        }
    }

    return bestMatch ? bestMatch.images.small : null;
}

// =====================================================================
// BACKGROUND AUTO-FETCH FUNCTION (V2 - SMART MATCHING + MULTI-SOURCE)
// =====================================================================
async function runBackgroundImageFetch() {
    try {
        const [rows] = await pool.query("SELECT id, name, set_name, card_number, language FROM inventory WHERE image_url IS NULL OR image_url = '' OR image_url = 'NOT_FOUND'");
        console.log(`[BG-FETCH] Memproses ${rows.length} kartu tanpa gambar...`);

        for (const card of rows) {
            try {
                const imageUrl = await fetchImageForCard(card);
                if (imageUrl) {
                    await pool.query("UPDATE inventory SET image_url = ? WHERE id = ?", [imageUrl, card.id]);
                    console.log(`[BG-FETCH] ✅ ${card.name} (${card.set_name}) -> ${imageUrl}`);
                } else {
                    await pool.query("UPDATE inventory SET image_url = 'NOT_FOUND' WHERE id = ?", [card.id]);
                    console.log(`[BG-FETCH] ❌ ${card.name} (${card.set_name}) -> NOT_FOUND`);
                }
            } catch (err) {
                console.error(`[BG-FETCH] ERROR ${card.name}:`, err.message);
                try {
                    await pool.query("UPDATE inventory SET image_url = 'NOT_FOUND' WHERE id = ?", [card.id]);
                } catch (dbErr) { /* ignore db error if closed */ }
            }
            await new Promise(r => setTimeout(r, 1500));
        }
        console.log(`[BG-FETCH] Selesai memproses ${rows.length} kartu.`);
    } catch (e) {
        console.error("[BG-FETCH] Catatan:", e.message);
    }
}

// --- PERBAIKAN: BULK IMPORT DENGAN FITUR ROLLBACK (TRANSAKSI) ---
app.post('/api/inventory/bulk-import', async (req, res) => {
    let conn = null;
    try {
        // 1. Kita minta jalur koneksi khusus (bukan pool biasa) untuk transaksi ini
        conn = await pool.getConnection();
        const items = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            if (conn) conn.release();
            return res.status(400).json({ error: 'Data kosong' });
        }

        let insertedCount = 0;
        let updatedCount = 0;

        // 2. MULAI MODE TRANSAKSI (Jika ada error, data tidak akan disimpan permanen)
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

            // PENTING: Gunakan 'conn.query', BUKAN 'pool.query' agar tetap di dalam jalur Transaksi
            // Relaxed check: Ignore set_code and card_number when merging to prevent duplicates
            const [existing] = await conn.query(
                `SELECT id FROM inventory WHERE status = 'Vault' AND name = ? AND set_name = ? AND language = ? AND card_condition = ? AND is_holo = ? AND is_first_edition = ? AND grader <=> ? AND grade <=> ? AND cert_number <=> ?`,
                [name, setName, lang, cond, isHolo, is1st, grader, grade, certNum]
            );

            if (existing.length > 0) {
                await conn.query(
                    `UPDATE inventory SET quantity = quantity + ?, purchase_price = ?, market_price = ?, image_url = COALESCE(?, image_url), card_number = COALESCE(card_number, ?), set_code = COALESCE(set_code, ?) WHERE id = ?`,
                    [safeQty, safePP, safeMP, i.image_url || null, cardNum, setCode, existing[0].id]
                );
                updatedCount++;
            } else {
                await conn.query(
                    `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, image_url, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Vault')`,
                    [crypto.randomUUID(), name, cat, setName, setCode, cardNum, lang, safeQty, safePP, safeMP, i.image_url || null, i.notes || null, cond, isHolo, is1st, grader, grade, certNum]
                );
                insertedCount++;
            }
        }
        
        // 3. JIKA SUKSES SEMUA: Simpan Permanen ke Brankas (Commit)
        await conn.commit(); 
        res.status(201).json({ message: `Selesai! ${insertedCount} Kartu Baru. ${updatedCount} Kartu digabung.` });
        
        // Trigger background fetch secara asinkron setelah koneksi dilepas
        setTimeout(() => runBackgroundImageFetch().catch(e => console.log("BG-FETCH note:", e.message)), 1000);

    } catch (error) { 
        // 4. JIKA ADA SATU SAJA YANG ERROR: Batalkan Semuanya (Rollback) ke kondisi semula
        if (conn) await conn.rollback(); 
        console.error("🔥 ERROR MYSQL BULK IMPORT - AUTO ROLLBACK DILAKUKAN:", error);
        res.status(500).json({ error: error.message || 'Gagal import, seluruh data dibatalkan (Rollback)' }); 
    } finally {
        // 5. Selalu lepas koneksi agar tidak membuat server macet
        if (conn) conn.release(); 
    }
});
// --- API BARU: BULK REPLACE (Hapus semua Vault, lalu masukkan baru) ---
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

        // 1. HAPUS SEMUA DATA YANG BERSTATUS 'Vault' (Data Sold tetap aman)
        await conn.query(`DELETE FROM inventory WHERE status = 'Vault'`);

        // 2. INSERT SEMUA DATA DARI CSV SEBAGAI DATA BARU
        for (const i of items) {
            const safeQty = parseInt(i.quantity) || 1;
            const safePP = typeof i.purchase_price === 'number' ? Math.round(i.purchase_price) : Math.round(parseFloat(String(i.purchase_price || 0).replace(/,/g, '').replace(/[^0-9.-]/g, '')) || 0);
            const safeMP = typeof i.market_price === 'number' ? Math.round(i.market_price) : Math.round(parseFloat(String(i.market_price || 0).replace(/,/g, '').replace(/[^0-9.-]/g, '')) || 0);
            const sStr = (v, max = 250) => (v !== null && v !== undefined && v !== '') ? String(v).slice(0, max) : null;

            await conn.query(
                `INSERT INTO inventory (id, name, category, set_name, set_code, card_number, language, quantity, purchase_price, market_price, image_url, notes, card_condition, is_holo, is_first_edition, grader, grade, cert_number, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Vault')`,
                [
                    crypto.randomUUID(), 
                    sStr(i.name, 250) || 'Unnamed', 
                    sStr(i.category, 100) || 'Single', 
                    sStr(i.set_name, 250) || '-', 
                    sStr(i.set_code, 100), 
                    sStr(i.card_number, 100), 
                    sStr(i.language, 100) || 'English', 
                    safeQty, safePP, safeMP, 
                    i.image_url || null, 
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
        
        // Trigger background fetch secara asinkron setelah koneksi dilepas
        setTimeout(() => runBackgroundImageFetch().catch(e => console.log("BG-FETCH note:", e.message)), 1000);
        
    } catch (error) { 
        if (conn) await conn.rollback(); 
        console.error("ERROR MYSQL BULK REPLACE:", error);
        res.status(500).json({ error: error.message || 'Gagal replace data' }); 
    } finally {
        if (conn) conn.release(); 
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

// =====================================================================
// API BARU: RE-FETCH GAMBAR (Reset NOT_FOUND & gambar yang salah)
// =====================================================================
app.post('/api/refetch-images', async (req, res) => {
    try {
        // Reset semua NOT_FOUND menjadi NULL agar bisa di-fetch ulang
        const [resetResult] = await pool.query("UPDATE inventory SET image_url = NULL WHERE image_url = 'NOT_FOUND'");
        const resetCount = resetResult.affectedRows || 0;

        // Hitung total yang akan di-proses
        const [countResult] = await pool.query("SELECT COUNT(*) as c FROM inventory WHERE image_url IS NULL OR image_url = ''");
        const totalToFetch = countResult[0].c;

        res.status(200).json({ 
            message: `Re-fetch dimulai! ${resetCount} kartu NOT_FOUND di-reset. Total ${totalToFetch} kartu akan di-proses.`,
            total: totalToFetch 
        });

        // Jalankan background fetch secara async
        runBackgroundImageFetch().catch(console.error);
    } catch (error) {
        console.error("Refetch error:", error);
        res.status(500).json({ error: 'Gagal memulai re-fetch' });
    }
});

// API: Re-fetch gambar untuk 1 kartu spesifik
app.post('/api/refetch-image/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Reset image_url agar bisa di-fetch ulang
        await pool.query("UPDATE inventory SET image_url = NULL WHERE id = ?", [id]);
        
        // Fetch ulang kartu ini saja
        const [rows] = await pool.query("SELECT id, name, set_name, card_number, language FROM inventory WHERE id = ?", [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Kartu tidak ditemukan' });
        
        const card = rows[0];
        const imageUrl = await fetchImageForCard(card);

        if (imageUrl) {
            await pool.query("UPDATE inventory SET image_url = ? WHERE id = ?", [imageUrl, id]);
            res.status(200).json({ message: 'Gambar ditemukan!', image_url: imageUrl });
        } else {
            await pool.query("UPDATE inventory SET image_url = 'NOT_FOUND' WHERE id = ?", [id]);
            res.status(200).json({ message: 'Gambar tidak ditemukan', image_url: 'NOT_FOUND' });
        }
    } catch (error) {
        console.error("Single refetch error:", error);
        res.status(500).json({ error: 'Gagal re-fetch' });
    }
});

// API: Force reset semua gambar yang salah (clear all external images untuk re-fetch)
app.post('/api/reset-all-images', async (req, res) => {
    try {
        // Reset SEMUA gambar external (bukan upload lokal) menjadi NULL
        const [result] = await pool.query("UPDATE inventory SET image_url = NULL WHERE image_url LIKE 'https://%' OR image_url = 'NOT_FOUND'");
        const resetCount = result.affectedRows || 0;
        res.status(200).json({ message: `${resetCount} gambar di-reset. Gunakan Re-fetch untuk mengambil ulang.`, reset: resetCount });
    } catch (error) {
        res.status(500).json({ error: 'Gagal reset' });
    }
});

// Global API 404 Handler agar rute API yang tidak ditemukan/salah selalu merespon JSON (bukan HTML)
app.use('/api', (req, res) => {
    res.status(404).json({ error: `Endpoint API tidak ditemukan: ${req.method} ${req.originalUrl}` });
});

// Global Express Error Handler agar unhandled errors/payload errors merespon JSON dengan jelas (bukan HTML <!DOCTYPE ...>)
app.use((err, req, res, next) => {
    console.error("Express Global Error:", err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: err.message || "Terjadi kesalahan internal pada server Node.js" });
});

app.listen(3000, () => console.log('Holovault Backend V10.0 SMART-FETCH MENYALA di http://localhost:3000'));