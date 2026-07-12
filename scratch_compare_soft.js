const xlsx = require('xlsx');
const fs = require('fs');

const export4Path = 'C:\\Users\\ekawi\\Downloads\\export (4).csv.xlsx';
const dbExportPath = 'C:\\Users\\ekawi\\Downloads\\Holovault_Export_2026-07-12.xlsx';
const outputPath = 'C:\\Users\\ekawi\\.gemini\\antigravity-ide\\brain\\8a120cbf-d967-4b94-ab12-d53130200828\\export_comparison_report_soft.md';

function getSheetData(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const workbook = xlsx.readFile(filePath);
    return xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
}

const data4 = getSheetData(export4Path) || [];
const dataDb = getSheetData(dbExportPath) || [];

function makeSoftSig4(row) {
    let name = (row['Product Name'] || '').toString().trim().toLowerCase();
    let set = (row['Set'] || '').toString().trim().toLowerCase();
    return [name, set].join('|');
}
function makeSoftSigDb(row) {
    let name = (row['Name'] || '').toString().trim().toLowerCase();
    let set = (row['Set'] || '').toString().trim().toLowerCase();
    return [name, set].join('|');
}

const softSigsDb = new Set(dataDb.map(makeSoftSigDb));
const softSigs4 = new Set(data4.map(makeSoftSig4));

const missingInDb = [];
const missingIn4 = [];
const missingSigsDb = new Set();
const missingSigs4 = new Set();

for (const row of data4) {
    const sig = makeSoftSig4(row);
    if (!softSigsDb.has(sig) && !missingSigsDb.has(sig)) {
        missingInDb.push(row);
        missingSigsDb.add(sig);
    }
}

for (const row of dataDb) {
    const sig = makeSoftSigDb(row);
    if (!softSigs4.has(sig) && !missingSigs4.has(sig)) {
        missingIn4.push(row);
        missingSigs4.add(sig);
    }
}

let md = `# Laporan Perbandingan Item (Akurat - Mengabaikan Bug Nomor Kartu)

- **Total di Export (4)**: ${data4.length} item.
- **Total di DB Export**: ${dataDb.length} item.

Karena *Card Number* di DB Export banyak yang rusak akibat bug format tanggal Excel (seperti \`08/25\` berubah menjadi \`37128.000...\`), perbandingan ini **hanya menggunakan Nama Item dan Set**. Ini akan memberikan hasil yang jauh lebih akurat tentang item mana yang benar-benar berbeda.

## 1. Item HANYA ada di Export(4) (${missingInDb.length} item unik)
`;

missingInDb.forEach(r => {
    md += `- **${r['Product Name']}** | Set: ${r['Set']}\n`;
});

md += `\n## 2. Item HANYA ada di DB Export (${missingIn4.length} item unik)\n`;
missingIn4.forEach(r => {
    md += `- **${r['Name']}** | Set: ${r['Set']}\n`;
});

fs.writeFileSync(outputPath, md, 'utf-8');
console.log('Artifact created at:', outputPath);
