const mysql = require('mysql2/promise');
async function check() {
    const pool = mysql.createPool({ host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com', port: 4000, user: 'bHEitaKtTPBTcrk.root', password: 'qPOxc0nuVez63w32', database: 'test', ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }});
    const [rows] = await pool.query("SELECT name, set_name, language FROM inventory WHERE name = 'Nidoking' OR name = 'Pikachu (Friend Ball)' OR name = 'Dubwool V'");
    console.log(rows);
    process.exit(0);
}
check();
