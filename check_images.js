const axios = require('axios');
const cheerio = require('cheerio');

async function crawlPokellector(query, isJP = false) {
    try {
        const base = isJP ? 'https://jp.pokellector.com' : 'https://www.pokellector.com';
        const url = `${base}/search?criteria=${encodeURIComponent(query)}`;
        console.log(`  Fetching: ${url}`);
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html',
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
    } catch (e) {
        console.log(`  Error: ${e.message}`);
        return [];
    }
}

async function testPokemonTCGAPI(name, setName) {
    try {
        const queries = [`name:"${name}"`];
        if (setName) queries.push(`set.name:"${setName}"`);
        const apiUrl = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(queries.join(' '))}&pageSize=5`;
        console.log(`  API: ${apiUrl}`);
        const response = await fetch(apiUrl, { headers: { 'User-Agent': 'Holovault/1.0' } });
        const data = await response.json();
        return (data.data || []).map(c => ({
            name: c.name,
            set: c.set?.name,
            number: c.number,
            image: c.images?.small
        }));
    } catch (e) {
        console.log(`  API Error: ${e.message}`);
        return [];
    }
}

async function run() {
    const testCards = [
        // Inferno X cards
        { name: 'Charcadet', set: 'Inferno X', num: '083/080', lang: 'English' },
        { name: 'Firebreather', set: 'Inferno X', num: '107/080', lang: 'English' },
        { name: 'Wigglytuff', set: 'Inferno X', num: '091/080', lang: 'English' },
        // Shiny Star V JP cards 
        { name: 'Centiscorch V', set: 'Shiny Star V', num: '027/070', lang: 'Japanese' },
        { name: 'Dubwool V', set: 'Shiny Star V', num: '154/190', lang: 'Japanese' },
        { name: 'Eldegoss V', set: 'Shiny Star V', num: '16/190', lang: 'Japanese' },
        { name: 'Zacian V', set: 'Shiny Star V', num: '137/190', lang: 'Japanese' },
    ];

    for (const card of testCards) {
        console.log(`\n=== ${card.name} | ${card.set} | #${card.num} | ${card.lang} ===`);
        
        // Try pokellector JP
        console.log('  [1] Pokellector JP:');
        let jpResults = await crawlPokellector(`${card.name} ${card.set}`, true);
        if (jpResults.length > 0) {
            jpResults.slice(0, 3).forEach(r => console.log(`    ✅ ${r.name} | ${r.set} | ${r.imgUrl}`));
        } else {
            console.log('    ❌ No results');
            // Try just name on JP
            jpResults = await crawlPokellector(card.name, true);
            if (jpResults.length > 0) {
                jpResults.slice(0, 3).forEach(r => console.log(`    (name only) ✅ ${r.name} | ${r.set} | ${r.imgUrl}`));
            }
        }

        // Try pokellector EN
        console.log('  [2] Pokellector EN:');
        let enResults = await crawlPokellector(`${card.name} ${card.set}`);
        if (enResults.length > 0) {
            enResults.slice(0, 3).forEach(r => console.log(`    ✅ ${r.name} | ${r.set} | ${r.imgUrl}`));
        } else {
            console.log('    ❌ No results');
        }

        // Try pokemontcg.io API
        console.log('  [3] PokemonTCG API:');
        let apiResults = await testPokemonTCGAPI(card.name, card.set);
        if (apiResults.length > 0) {
            apiResults.slice(0, 3).forEach(r => console.log(`    ✅ ${r.name} | ${r.set} | #${r.number} | ${r.image}`));
        } else {
            console.log('    ❌ No results with set, trying without...');
            apiResults = await testPokemonTCGAPI(card.name, null);
            apiResults.slice(0, 3).forEach(r => console.log(`    ✅ ${r.name} | ${r.set} | #${r.number} | ${r.image}`));
        }

        await new Promise(r => setTimeout(r, 1500));
    }
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
