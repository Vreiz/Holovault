const axios = require('axios');
const mysql = require('mysql2/promise');

async function testFetch() {
    const pool = mysql.createPool({ host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com', port: 4000, user: 'bHEitaKtTPBTcrk.root', password: 'qPOxc0nuVez63w32', database: 'test', ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }});
    const [rows] = await pool.query("SELECT id, name, set_name, language FROM inventory WHERE image_url IS NULL OR image_url = '' LIMIT 10");
    
    console.log("Fetching for", rows.length, "cards");
    const concurrency = 5;
    for (let i = 0; i < rows.length; i += concurrency) {
        const batch = rows.slice(i, i + concurrency);
        await Promise.all(batch.map(async (card) => {
            console.log(`Querying: ${card.name} [${card.language}]`);
            try {
                let res;
                if (card.language === 'Japanese') {
                    const query = card.name + (card.set_name && card.set_name !== '-' ? " " + card.set_name : "");
                    res = await axios.get(`http://localhost:3000/api/search-jp?query=${encodeURIComponent(query)}`);
                } else {
                    res = await axios.get(`http://localhost:3000/api/search-card?name=${encodeURIComponent(card.name)}&set=${encodeURIComponent(card.set_name === '-' ? '' : card.set_name)}`);
                }
                
                const searchResults = res.data;
                if (searchResults && searchResults.length > 0 && searchResults[0].images && searchResults[0].images.small) {
                    console.log(`Found image for ${card.name}: ${searchResults[0].images.small}`);
                    await pool.query("UPDATE inventory SET image_url = ? WHERE id = ?", [searchResults[0].images.small, card.id]);
                } else {
                    console.log(`NO IMAGE for ${card.name}`);
                }
            } catch (err) {
                console.error(`ERROR for ${card.name}:`, err.message);
            }
        }));
        await new Promise(r => setTimeout(r, 500)); 
    }
    process.exit(0);
}
testFetch();
