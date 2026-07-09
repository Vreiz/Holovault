const axios = require('axios');
const cheerio = require('cheerio');

async function crawlPokellectorEN(cardName, setName) {
    try {
        const query = cardName + (setName && setName !== '-' ? ' ' + setName : '');
        const url = `https://www.pokellector.com/search?criteria=${encodeURIComponent(query)}`;
        console.log("Fetching:", url);
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html'
            },
            timeout: 10000
        });
        const $ = cheerio.load(response.data);
        let results = [];
        $('.cardresult').each((i, el) => {
            const imgUrl = $(el).find('img.card').attr('data-src') || $(el).find('img.card').attr('src');
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
        console.log("Error:", e.message);
        return [];
    }
}

async function run() {
    const res = await crawlPokellectorEN("Dubwool V", "");
    console.log(`Found ${res.length} results:`);
    res.forEach(r => console.log(`  - ${r.name} | Set: "${r.set.name}" | #${r.number} | ${r.images.small}`));
}
run();
