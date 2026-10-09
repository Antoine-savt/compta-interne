/**
 * ValidationPeriode.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Validation (verrouillage) des écritures jusqu'à une date : numérotation définitive,
 * date de validation, et plus aucune modification possible dans la période.
 * À faire idéalement chaque mois, une fois le relevé Shine rapproché.
 */
import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { validerPeriode } from '../services/api';
import { getEcrituresActives } from '../services/comptaService';
import { chargerTransactions } from '../services/banqueService';
import { formatDate, toISODate } from '../services/helpers';
import { DateInput } from './common/DateInput';

/** Dernier jour du mois précédent (proposition par défaut). */
function finMoisPrecedent() {
    const d = new Date();
    return toISODate(new Date(d.getFullYear(), d.getMonth(), 0));
}

export function ValidationPeriode() {
    const [verrou, setVerrou] = useState(null);
    const [dateCible, setDateCible] = useState(finMoisPrecedent());
    const [ecritures, setEcritures] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    const charger = useCallback(async () => {
        const [snap, ecr, txs] = await Promise.all([
            getDoc(doc(db, 'settings', 'verrou')),
            getEcrituresActives({}, { forceRefresh: true }),
            chargerTransactions().catch(() => []),
        ]);
        setVerrou(snap.exists() ? snap.data() : null);
        setEcritures(ecr);
        setTransactions(txs);
    }, []);

    useEffect(() => { charger(); }, [charger]);

    const dateVerrou = verrou?.dateVerrou ?? null;
    const aValider = ecritures.filter((e) => !e.validee && e.dateStr && e.dateStr <= dateCible);
    const bancairesNonTraitees = transactions.filter((t) => t.statut === 'a_traiter' && !t.lieeA && t.date <= dateCible && (!dateVerrou || t.date > dateVerrou));
    const dateInvalide = (dateVerrou && dateCible <= dateVerrou) || dateCible > toISODate(new Date());

    async function valider() {
        const avert = bancairesNonTraitees.length
            ? `\n\nAttention : ${bancairesNonTraitees.length} transaction(s) Shine de cette période ne sont pas encore rattachées. Après validation, elles devront être enregistrées à une date postérieure.`
            : '';
        if (!window.confirm(`Valider définitivement les écritures jusqu'au ${formatDate(dateCible)} ?\n\n${aValider.length} écriture(s) recevront un numéro définitif. Elles ne pourront plus être modifiées que par contre-passation, et aucune écriture ne pourra plus être datée avant le ${formatDate(dateCible)}.${avert}`)) return;
        setSaving(true);
        setMessage(null);
        try {
            const res = await validerPeriode(dateCible);
            setMessage({
                type: 'success',
                text: res.nbValidees
                    ? `Période validée jusqu'au ${formatDate(res.dateVerrou)} : ${res.nbValidees} écriture(s) numérotée(s) de ${res.premierNumero} à ${res.dernierNumero}.`
                    : `Période validée jusqu'au ${formatDate(res.dateVerrou)} (aucune nouvelle écriture à numéroter).`,
            });
            await charger();
        } catch (err) {
            setMessage({ type: 'danger', text: err.message });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="card">
            <div className="card__title">Validation des écritures</div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
                Tant qu'une période n'est pas validée, les écritures restent en brouillard et se modifient librement.
                La validation leur donne un numéro définitif et les fige (obligation légale d'inaltérabilité) :
                une correction ultérieure se fera automatiquement par contre-passation. Conseil : validez chaque mois,
                une fois le relevé Shine entièrement rattaché.
            </p>

            {message && <div className={`notice notice--${message.type}`}>{message.text}</div>}

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Validé jusqu'au</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{dateVerrou ? formatDate(dateVerrou) : 'Aucune période validée'}</div>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Valider jusqu'au</label>
                    <DateInput className="form-input" value={dateCible} onChange={(e) => setDateCible(e.target.value)} />
                </div>
                <button className="btn btn--primary" onClick={valider} disabled={saving || dateInvalide}>
                    {saving ? 'Validation...' : `Valider ${aValider.length} écriture(s)`}
                </button>
            </div>

            {dateInvalide && (
                <p className="form-hint" style={{ marginTop: 8 }}>
                    Choisissez une date postérieure au {dateVerrou ? formatDate(dateVerrou) : '—'} et au plus tard aujourd'hui.
                </p>
            )}
            {!dateInvalide && bancairesNonTraitees.length > 0 && (
                <div className="notice notice--warning" style={{ marginTop: 12, marginBottom: 0 }}>
                    {bancairesNonTraitees.length} transaction(s) Shine de cette période restent à rattacher (Banque → Compte Shine).
                    Rattachez-les avant de valider pour que tout soit enregistré à la bonne date.
                </div>
            )}

            {verrou?.historique?.length > 0 && (
                <details style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                    <summary style={{ cursor: 'pointer' }}>Historique des validations</summary>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                        {[...verrou.historique].reverse().map((h, i) => (
                            <li key={i}>Validé jusqu'au {formatDate(h.dateVerrou)} le {formatDate(h.at)} · {h.nbValidees} écriture(s)</li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
}
