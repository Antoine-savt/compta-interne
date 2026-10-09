/**
 * banqueService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Import des relevés bancaires Shine (export CSV) et suivi du rapprochement.
 *
 * Collection Firestore `banqueTransactions` (id = Transaction ID Shine, ce qui
 * rend l'import idempotent : réimporter le même fichier n'ajoute aucun doublon).
 * Document `settings/banque` : dernier solde bancaire connu.
 */

import { collection, doc, getDoc, getDocs, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const COLLECTION = 'banqueTransactions';

// ─── Lecture du CSV Shine ────────────────────────────────────────────────────

/** Découpe un CSV (séparateur ;) en gérant les guillemets et les retours à la ligne dans les champs. */
function parseCSV(text, sep = ';') {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const s = text.replace(/^﻿/, '');

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inQuotes) {
            if (ch === '"') {
                if (s[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === sep) {
            row.push(field); field = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && s[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some((c) => c !== '')) rows.push(row);
            row = [];
        } else {
            field += ch;
        }
    }
    row.push(field);
    if (row.some((c) => c !== '')) rows.push(row);
    return rows;
}

/** "1 234,56" -> 1234.56 */
function parseMontant(v) {
    if (!v) return 0;
    const n = parseFloat(String(v).replace(/\s| /g, '').replace(',', '.'));
    return isNaN(n) ? 0 : +n.toFixed(2);
}

/** "26/09/2026" -> "2026-09-26" */
function parseDateFR(v) {
    const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

const COLONNES_REQUISES = ['Transaction ID', "Date d'opération", 'Débit', 'Crédit', 'Libellé'];

/**
 * Transforme le texte d'un export CSV Shine en transactions normalisées.
 * @returns {Array<Object>} transactions dans l'ordre du fichier
 */
export function parseShineCSV(text) {
    const rows = parseCSV(text);
    if (rows.length === 0) return [];
    const headers = rows[0].map((h) => h.trim());
    const manquantes = COLONNES_REQUISES.filter((c) => !headers.includes(c));
    if (manquantes.length) {
        throw new Error(`Ce fichier ne ressemble pas à un export Shine (colonnes manquantes : ${manquantes.join(', ')}).`);
    }
    const col = (r, name) => r[headers.indexOf(name)] ?? '';

    return rows.slice(1).map((r, rang) => {
        const debit = parseMontant(col(r, 'Débit'));
        const credit = parseMontant(col(r, 'Crédit'));
        const type = col(r, 'Type de transaction').trim();
        const commentaire = col(r, 'Commentaire').trim();
        // Shine lie ses commissions à la transaction d'origine : "Liée à X au JJ/MM/AAAA - ID: <uuid>"
        const lien = commentaire.match(/ID:\s*([0-9a-f-]{36})/i);
        return {
            shineId: col(r, 'Transaction ID').trim(),
            date: parseDateFR(col(r, "Date d'opération")),
            dateValeur: parseDateFR(col(r, 'Date de la valeur')),
            type,
            libelle: col(r, 'Libellé').trim(),
            contrepartie: col(r, 'Nom de la contrepartie').trim(),
            categorieShine: col(r, 'Category').trim(),
            debit,
            credit,
            montant: +(credit - debit).toFixed(2),
            soldeBancaire: parseMontant(col(r, 'Solde bancaire')),
            tvaTotal: parseMontant(col(r, 'Montant de TVA total')),
            personnelle: col(r, 'Transaction personnelle').trim() === 'Oui',
            pieces: col(r, 'Pièces').trim() || null,
            commentaire: commentaire || null,
            iban: col(r, 'IBAN').trim() || null,
            lieeA: type === 'Commission' && lien ? lien[1] : null,
            rang,
        };
    }).filter((t) => t.shineId && t.date);
}

// ─── Firestore ──────────────────────────────────────────────────────────────

export async function chargerTransactions() {
    const snap = await getDocs(collection(db, COLLECTION));
    return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.rang ?? 0) - (a.rang ?? 0));
}

export async function chargerSoldeBanque() {
    const snap = await getDoc(doc(db, 'settings', 'banque'));
    return snap.exists() ? snap.data() : null;
}

/**
 * Enregistre les nouvelles transactions (les transactions déjà importées sont conservées telles quelles).
 * @returns {{ nouvelles: number, dejaPresentes: number }}
 */
export async function importerTransactions(transactions) {
    const existantes = new Set((await getDocs(collection(db, COLLECTION))).docs.map((d) => d.id));
    const nouvelles = transactions.filter((t) => !existantes.has(t.shineId));

    for (let i = 0; i < nouvelles.length; i += 400) {
        const batch = writeBatch(db);
        nouvelles.slice(i, i + 400).forEach((t) => {
            batch.set(doc(db, COLLECTION, t.shineId), {
                ...t,
                statut: t.personnelle ? 'ignoree' : 'a_traiter',
                rapprochement: t.personnelle ? { type: 'ignoree', label: 'Transaction personnelle (Shine)' } : null,
                importedAt: serverTimestamp(),
            });
        });
        await batch.commit();
    }

    // Dernier solde connu = dernière ligne du fichier (Shine exporte dans l'ordre chronologique)
    const derniere = transactions[transactions.length - 1];
    if (derniere) {
        const actuel = await chargerSoldeBanque();
        if (!actuel?.date || derniere.date >= actuel.date) {
            await setDoc(doc(db, 'settings', 'banque'), {
                soldeBancaire: derniere.soldeBancaire,
                date: derniere.date,
                iban: derniere.iban,
                updatedAt: serverTimestamp(),
            });
        }
    }

    return { nouvelles: nouvelles.length, dejaPresentes: transactions.length - nouvelles.length };
}

export async function majTransaction(id, fields) {
    await setDoc(doc(db, COLLECTION, id), { ...fields, updatedAt: serverTimestamp() }, { merge: true });
}

// ─── Aide au rapprochement ──────────────────────────────────────────────────

/** Variation du compte 512 portée par une écriture (débit - crédit). */
export function mouvement512(ecriture) {
    return +(ecriture.mouvements || [])
        .filter((m) => String(m.compte).startsWith('512'))
        .reduce((s, m) => s + (+m.debit || 0) - (+m.credit || 0), 0)
        .toFixed(2);
}

/**
 * Écritures déjà présentes en compta qui correspondent probablement à la transaction
 * (même impact sur le compte 512, à ±10 jours), hors écritures déjà rapprochées.
 */
export function trouverCorrespondances(tx, montantNet, ecritures, ecrituresDejaLiees) {
    const cibles = [montantNet, tx.montant].map((m) => +m.toFixed(2));
    const dTx = new Date(tx.date).getTime();
    return ecritures
        .filter((e) => !ecrituresDejaLiees.has(e.id))
        .map((e) => ({ e, delta: mouvement512(e) }))
        .filter(({ delta }) => delta !== 0 && cibles.some((c) => Math.abs(c - delta) < 0.01))
        .map(({ e, delta }) => ({ ...e, delta512: delta, ecartJours: Math.round(Math.abs(e.dateObj.getTime() - dTx) / 86400000) }))
        .filter((e) => e.ecartJours <= 10)
        .sort((a, b) => a.ecartJours - b.ecartJours);
}
