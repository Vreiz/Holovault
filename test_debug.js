const axios = require('axios');
const cheerio = require('cheerio');

async function crawlPokellectorJP(query) {
    try {
        if (!query) return [];
        const baseUrl = `https://jp.pokellector.com/search?criteria=${encodeURIComponent(query)}`;
        let hasilKartu = [];

        const fetchPage = async (pageUrl) => {
            const response = await axios.get(pageUrl, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
        return hasilKartu;
    } catch (error) {
        console.error("Crawler JP Error:", error.message);
        return [];
    }
}

async function run() {
    const cards = [
        { name: 'Centiscorch V', set_name: 'Shiny Star V', card_number: '027/070' },
        { name: 'Dubwool V', set_name: 'Shiny Star V', card_number: '154/190' },
        { name: 'Eldegoss V', set_name: 'Shiny Star V', card_number: '16/190' },
        { name: 'Zacian V', set_name: 'Shiny Star V', card_number: '137/190' }
    ];

    for (const c of cards) {
        console.log(`\nTesting ${c.name} (${c.set_name} #${c.card_number}):`);
        const query = `${c.name} ${c.set_name}`;
        const res = await crawlPokellectorJP(query);
        console.log(`  JP query "${query}": found ${res.length} items`);
        if (res.length > 0) {
            console.log(JSON.stringify(res.slice(0, 3), null, 2));
        } else {
            const res2 = await crawlPokellectorJP(c.name);
            console.log(`  JP query "${c.name}": found ${res2.length} items`);
            if (res2.length > 0) {
                console.log(JSON.stringify(res2.slice(0, 3), null, 2));
            }
        }
    }
}
run();
