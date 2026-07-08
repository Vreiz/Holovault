const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://jp.pokellector.com/search?criteria=ninja+spinner&page=10', {
    headers: {
        'User-Agent': 'Mozilla/5.0'
    }
}).then(r => {
    const $ = cheerio.load(r.data);
    console.log('Page 10 results:', $('.cardresult').length);
}).catch(e=>console.log(e.message));
