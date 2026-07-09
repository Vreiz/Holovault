const axios = require('axios');
const cheerio = require('cheerio');

function findBestMatch(searchResults, targetName, targetSetName, targetNumber) {
    if (!searchResults || searchResults.length === 0) return null;

    const tName = (targetName || '').trim().toLowerCase();
    const tSet = (targetSetName || '').trim().toLowerCase();
    const tNum = (targetNumber || '').split('/')[0].replace(/^0+/, '').toLowerCase();

    let bestCard = null;
    let bestScore = 0;

    for (const card of searchResults) {
        if (!card.images || !card.images.small) continue;
        let score = 0;

        const cName = (card.name || '').trim().toLowerCase();
        const cSet = (card.set && card.set.name ? card.set.name : '').trim().toLowerCase();
        const cNum = (card.number || '').split('/')[0].replace(/^0+/, '').toLowerCase();

        if (cName === tName) score += 50;
        else if (cName.includes(tName) || tName.includes(cName)) score += 10;

        if (tSet && cSet && (cSet === tSet || cSet.includes(tSet) || tSet.includes(cSet))) {
            score += 30;
        } else if (tSet && cSet && tSet !== '-' && cSet !== '-') {
            score -= 20;
        }

        if (tNum && cNum && cNum === tNum) score += 40;

        console.log(`[Score Check] cName="${cName}", cSet="${cSet}", cNum="${cNum}" -> score=${score}`);

        if (score > bestScore) {
            bestScore = score;
            bestCard = card;
        }
    }
    return bestCard;
}

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
        return [];
    }
}

async function run() {
    console.log("Crawling Pokellector EN for Dubwool V + Shiny Star V...");
    const res = await crawlPokellectorEN("Dubwool V", "Shiny Star V");
    console.log(`Found ${res.length} results:`, res);
    const best = findBestMatch(res, "Dubwool V", "Shiny Star V", "154/190");
    console.log("Best Match:", best);
}
run();
