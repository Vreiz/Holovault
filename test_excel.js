const XLSX = require('xlsx');

// Read the excel file
const workbook = XLSX.readFile('C:\\Users\\ekawi\\Downloads\\Book1.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rawJsonData = XLSX.utils.sheet_to_json(sheet);

console.log(`Read ${rawJsonData.length} rows.`);

if (rawJsonData.length > 0) {
    const item = rawJsonData[0];
    console.log("Raw Object keys:", Object.keys(item));
    console.log("Raw Object entries:", item);
    
    const keys = Object.keys(item);
    
    const findVal = (targets) => {
        for(let t of targets) {
            let k = keys.find(x => x.trim().toLowerCase() === t.toLowerCase());
            if(k) return item[k];
        }
        for(let t of targets) {
            let k = keys.find(x => x.trim().toLowerCase().includes(t.toLowerCase()));
            if(k) return item[k];
        }
        return null;
    };
    
    const rawCost = findVal([
        'market price', 'market_price', 'market value', 'market_value',
        'current value', 'current_value', 'card value', 'card_value',
        'estimated value', 'est. value', 'est value',
        'round', 'rounded', 'purchase_price', 'purchase price',
        'tcg price', 'tcg market', 'total value',
        'market'
    ]);
    
    console.log("Found rawCost:", rawCost);
    
    const parseSmartNumber = (v) => {
        if (v === null || v === undefined || v === '') return 0;
        if (typeof v === 'number') return v; 
        const s = String(v).trim().replace(/[Rp$?\s]/gi, '');
        const hasDot = s.includes('.');
        const hasComma = s.includes(',');
        let c = s;
        if (hasDot && !hasComma) {
            const parts = s.split('.');
            const afterLastDot = parts[parts.length - 1];
            if (afterLastDot.length === 3 && parts.length === 2) {
                c = s.replace(/\./g, ''); 
            }
        } else if (hasComma && !hasDot) {
            c = s.replace(/,/g, ''); 
        } else if (hasDot && hasComma) {
            if (s.indexOf('.') < s.indexOf(',')) {
                c = s.replace(/\./g, '').replace(',', '.'); 
            } else {
                c = s.replace(/,/g, ''); 
            }
        }
        c = c.replace(/[^0-9.-]/g, '');
        return parseFloat(c) || 0;
    };
    
    let costPrice = 0;
    if (rawCost !== null && rawCost !== undefined && rawCost !== '') {
        costPrice = Math.round(parseSmartNumber(rawCost) / 10000) * 10000;
    }
    
    console.log("parseSmartNumber:", parseSmartNumber(rawCost));
    console.log("costPrice:", costPrice);
}
