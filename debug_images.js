const mysql = require('mysql2/promise');
const axios = require('axios');
const cheerio = require('cheerio');

async function crawlPokellector(query, isJP = false) {
    try {
        const base = isJP ? 'https://jp.pokellector.com' : 'https://www.pokellector.com';
        const url = `${base}/search?criteria=${encodeURIComponent(query)}`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html',
                ...(isJP ? { 'Cookie': 'PokemonDatabaseLanguage=jp; locale=ja; region=jp;' } : {})
            }, timeout: 10000
        });
        const $ = cheerio.load(response.data);
        let results = [];
        $('.cardresult').each((i, el) => {
            const imgUrl = $(el).find('img.card').attr('data-src') || $(el).find('img.card').attr('src');
            if (!imgUrl || imgUrl.includes('card-placeholder')) return;
            const name = $(el).find('.detail .name').text().trim();
            const set = $(el).find('.detail .set').text().trim();
            results.push({ name, set, imgUrl });
        });
        return results;
    } catch (e) { return []; }
}

async function run() {
    const pool = mysql.createPool({ host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com', port: 4000, user: 'bHEitaKtTPBTcrk.root', password: 'qPOxc0nuVez63w32', database: 'test', ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }});
    
    const [rows] = await pool.query("SELECT name, set_name, card_number, language FROM inventory WHERE (image_url IS NULL OR image_url = '' OR image_url = 'NOT_FOUND') AND status='Vault'");
    console.log(`${rows.length} cards still missing images:\n`);
    
    for (const r of rows) {
        console.log(`=== ${r.name} | ${r.set_name} | #${r.card_number} | ${r.language} ===`);
        const cleanName = r.name.replace(/\s*\(.*?\)\s*/g, '').trim();
        
        // Try pokellector EN
        let results = await crawlPokellector(`${cleanName} ${r.set_name}`);
        if (results.length > 0) {
            console.log(`  pokellector EN: ${results[0].name} | ${results[0].set} | ${results[0].imgUrl}`);
        } else {
            // Try pokellector JP
            results = await crawlPokellector(`${cleanName} ${r.set_name}`, true);
            if (results.length > 0) {
                console.log(`  pokellector JP: ${results[0].name} | ${results[0].set} | ${results[0].imgUrl}`);
            } else {
                // Try just the name
                results = await crawlPokellector(cleanName);
                if (results.length > 0) {
                    console.log(`  pokellector (name only): ${results[0].name} | ${results[0].set} | ${results[0].imgUrl}`);
                } else {
                    console.log(`  ❌ NOT FOUND ANYWHERE`);
                }
            }
        }
        await new Promise(r => setTimeout(r, 1500));
    }
    process.exit(0);
}
run();
