const mysql = require('mysql2/promise');
async function check() {
    const pool = mysql.createPool({ host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com', port: 4000, user: 'bHEitaKtTPBTcrk.root', password: 'qPOxc0nuVez63w32', database: 'test', ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }});
    const [rows] = await pool.query("SELECT name, image_url, status FROM inventory WHERE image_url IS NULL OR image_url = ''");
    console.log(rows.length + ' cards without images.');
    if(rows.length > 0) console.log(rows.slice(0,5));
    process.exit(0);
}
check();
