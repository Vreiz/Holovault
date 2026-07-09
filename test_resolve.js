const mysql = require('mysql2/promise');
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
        return [];
    }
}

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
        return [];
    }
}

async function fetchImageForCard(card) {
    const cleanName = (card.name || '').replace(/\s*\(.*?\)\s*/g, '').trim();
    const cleanNum = card.card_number ? card.card_number.split('/')[0].replace(/^0+/, '') : '';

    let bestMatch = null;

    if (card.language === 'Japanese') {
        let query = card.name + (card.set_name && card.set_name !== '-' ? " " + card.set_name : "");
        let res = await crawlPokellectorJP(query);
        bestMatch = findBestMatch(res, card.name, card.set_name, card.card_number);

        if (!bestMatch) {
            res = await crawlPokellectorJP(card.name);
            bestMatch = findBestMatch(res, card.name, card.set_name, card.card_number);
        }

        if (!bestMatch) {
            let pokResults = await crawlPokellectorEN(card.name, card.set_name);
            bestMatch = findBestMatch(pokResults, card.name, card.set_name, card.card_number);
            if (!bestMatch && card.set_name && card.set_name !== '-') {
                pokResults = await crawlPokellectorEN(card.name, '');
                bestMatch = findBestMatch(pokResults, card.name, card.set_name, card.card_number);
            }
        }

        if (!bestMatch) {
            try {
                let apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(`name:"${card.name}"`)}&pageSize=20`;
                let response = await fetch(apiUrl, { headers: { 'User-Agent': 'Holovault/1.0' } });
                let data = await response.json();
                bestMatch = findBestMatch(data.data || [], card.name, card.set_name, card.card_number);
            } catch(e) {}
        }
    } else {
        try {
            let queries = [`name:"${card.name}"`];
            if (card.set_name && card.set_name !== '-') queries.push(`set.name:"${card.set_name}"`);
            if (cleanNum) queries.push(`number:${cleanNum}`);

            let apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queries.join(' '))}&pageSize=20`;
            let response = await fetch(apiUrl, { headers: { 'User-Agent': 'Holovault/1.0' } });
            let data = await response.json();
            bestMatch = findBestMatch(data.data || [], card.name, card.set_name, card.card_number);

            if (!bestMatch && cleanName !== card.name) {
                queries = [`name:"${cleanName}"`];
                if (card.set_name && card.set_name !== '-') queries.push(`set.name:"${card.set_name}"`);
                if (cleanNum) queries.push(`number:${cleanNum}`);
                apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queries.join(' '))}&pageSize=20`;
                response = await fetch(apiUrl, { headers: { 'User-Agent': 'Holovault/1.0' } });
                data = await response.json();
                bestMatch = findBestMatch(data.data || [], card.name, card.set_name, card.card_number);
            }

            if (!bestMatch && card.set_name && card.set_name !== '-') {
                const fbUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(`name:"${card.name}"`)}&pageSize=20`;
                const fbResponse = await fetch(fbUrl, { headers: { 'User-Agent': 'Holovault/1.0' } });
                const fbData = await fbResponse.json();
                bestMatch = findBestMatch(fbData.data || [], card.name, card.set_name, card.card_number);
            }
        } catch(e) {}

        if (!bestMatch) {
            let pokResults = await crawlPokellectorEN(card.name, card.set_name);
            bestMatch = findBestMatch(pokResults, card.name, card.set_name, card.card_number);
            if (!bestMatch && card.set_name && card.set_name !== '-') {
                pokResults = await crawlPokellectorEN(card.name, '');
                bestMatch = findBestMatch(pokResults, card.name, card.set_name, card.card_number);
            }
        }

        if (!bestMatch) {
            let res = await crawlPokellectorJP(card.name);
            bestMatch = findBestMatch(res, card.name, card.set_name, card.card_number);
        }
    }

    return bestMatch ? bestMatch.images.small : null;
}

async function run() {
    const pool = mysql.createPool({
        host: 'gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
        port: 4000,
        user: 'bHEitaKtTPBTcrk.root',
        password: 'qPOxc0nuVez63w32',
        database: 'test',
        ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
    });

    const [rows] = await pool.query(
        "SELECT id, name, set_name, card_number, language, image_url FROM inventory WHERE (set_name LIKE '%Inferno%' OR set_name LIKE '%Shiny Star%') AND status='Vault' ORDER BY set_name, name"
    );

    console.log(`Testing resolve on ${rows.length} cards:\n`);
    for (const card of rows) {
        console.log(`[Testing] ${card.name} | ${card.set_name} | #${card.card_number} (${card.language})`);
        const resultUrl = await fetchImageForCard(card);
        if (resultUrl) {
            console.log(`   👉 FOUND: ${resultUrl}`);
            await pool.query("UPDATE inventory SET image_url = ? WHERE id = ?", [resultUrl, card.id]);
        } else {
            console.log(`   ❌ STILL NOT FOUND`);
            await pool.query("UPDATE inventory SET image_url = 'NOT_FOUND' WHERE id = ?", [card.id]);
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
