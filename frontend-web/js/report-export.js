// Exportacion de reportes a Excel sin dependencias externas.
// Formato: XML Spreadsheet 2003 (SpreadsheetML), un formato de Excel publicado por
// Microsoft que Excel abre de forma nativa. No es CSV: cada celda lleva su tipo
// explicito, por lo que una cadena nunca se evalua como formula.

const SHEET_NAME_INVALID = /[\\\/\?\*\[\]:]/g;
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[character]));
}

// Neutraliza inyeccion de formulas para el caso en que la celda se copie o se
// convierta a CSV. En SpreadsheetML la celda ya es inerte por su tipo.
export function neutralizeFormula(value) {
  const text = String(value ?? '');
  if (!text) return text;
  return FORMULA_TRIGGERS.includes(text[0]) ? `'${text}` : text;
}

function isNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string' || value.trim() === '') return false;
  return Number.isFinite(Number(value));
}

function cell(value) {
  if (value === null || value === undefined || value === '') {
    return '<Cell ss:Type="String"></Cell>';
  }
  if (isNumeric(value)) {
    return `<Cell ss:Type="Number">${escapeXml(Number(value))}</Cell>`;
  }
  return `<Cell ss:Type="String">${escapeXml(neutralizeFormula(value))}</Cell>`;
}

function row(values) {
  return `<Row>${(Array.isArray(values) ? values : [values]).map(cell).join('')}</Row>`;
}

function sheetName(name, index) {
  const cleaned = String(name || `Hoja${index + 1}`).replace(SHEET_NAME_INVALID, ' ').trim();
  return escapeXml((cleaned || `Hoja${index + 1}`).slice(0, 31));
}

// sheets: [{ name, rows: [[cell, cell, ...], ...] }]
export function buildSpreadsheetXml(sheets) {
  const list = Array.isArray(sheets) ? sheets : [];
  const body = list.map((sheet, index) => {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    return `<Worksheet ss:Name="${sheetName(sheet?.name, index)}"><Table>${rows.map(row).join('')}</Table></Worksheet>`;
  }).join('');
  return `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${body}</Workbook>`;
}

export function exportSheetsToExcel(sheets, filename) {
  const xml = buildSpreadsheetXml(sheets);
  const safeName = String(filename || 'reporte').replace(/[^A-Za-z0-9_.-]/g, '-');
  const blob = new Blob(['﻿', xml], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName.endsWith('.xls') ? safeName : `${safeName}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return xml;
}

export function objectRows(source, labels) {
  return (Array.isArray(labels) ? labels : []).map(([label, key]) => [label, source?.[key]]);
}

export function tableRows(items, columns) {
  const list = Array.isArray(items) ? items : [];
  const header = columns.map(([label]) => label);
  return [header, ...list.map(item => columns.map(([, key]) => item?.[key]))];
}

export function filterSummaryRows(params) {
  const entries = [...(params instanceof URLSearchParams ? params.entries() : Object.entries(params || {}))];
  if (!entries.length) return [['Filtros aplicados', 'Ninguno: reportes globales']];
  return [['Filtro', 'Valor'], ...entries];
}
