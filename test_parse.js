const item = {
  'Portfolio': 'Single',
  'Category': 'Pokemon',
  'Set': 'Ascended Heroes',
  'Product Name': 'Groudon',
  'Card Number': '108/217',
  'Average': 0,
  'Quantity': 1,
  'Market Price (As of 2024-07-04)': '574,600.24',
  'Price Override': 0,
  'Watchlist': 'FALSE'
};

const findVal = (targets) => {
    const keys = Object.keys(item);
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
    'average cost paid', 'average cost', 'average paid',
    'tcg price', 'tcg market', 'total value',
    'market'
]);

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
} else {
    // Last-resort fallback: find the largest numeric value in the row
    // (likely the market price column even if named unexpectedly)
    let maxNum = 0;
    for (const key of Object.keys(item)) {
        const v = item[key];
        if (typeof v === 'number' && v > maxNum) maxNum = v;
    }
    if (maxNum > 0) costPrice = Math.round(maxNum / 10000) * 10000;
}

console.log("Raw Cost:", rawCost);
console.log("Parsed Number:", parseSmartNumber(rawCost));
console.log("Final Cost Price:", costPrice);
