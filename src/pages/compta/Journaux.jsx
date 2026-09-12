/**
 * Journaux.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Consultation des Journaux Comptables légaux (VE, AC, BQ, OD)
 * et génération conforme du Fichier des Écritures Comptables (FEC).
 * Article A.47 A-1 du Livre des Procédures Fiscales (LPF).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getEcrituresActives, genererFEC, telechargerFichier } from '../../services/comptaService';
import { formatMontant, formatDate } from '../../services/helpers';

const JOURNAUX = [
    { code: '', label: 'Tous les journaux' },
    { code: 'VE', label: 'VE — Journal des Ventes' },
    { code: 'AC', label: 'AC — Journal des Achats' },
    { code: 'BQ', label: 'BQ — Journal de Banque' },
    { code: 'OD', label: 'OD — Opérations Diverses' },
];

export default function Journaux() {
    const anneeCourante = new Date().getFullYear();
    const [dateDebut, setDateDebut] = useState(`${anneeCourante}-01-01`);
    const [dateFin, setDateFin] = useState(new Date().toISOString().split('T')[0]);
    const [codeJournal, setCodeJournal] = useState('');
    const [ecritures, setEcritures] = useState([]);
    const [loading, setLoading] = useState(true);
    const [siren, setSiren] = useState('123456789');

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getEcrituresActives({ dateDebut, dateFin, journal: codeJournal || undefined });
            setEcritures(data);
        } catch (err) {
            console.error('Erreur chargement écritures:', err);
        } finally {
            setLoading(false);
        }
    }, [dateDebut, dateFin, codeJournal]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Génération et téléchargement du FEC normalisé
    function handleTelechargerFEC() {
        if (!siren.trim()) {
            alert('Veuillez renseigner le numéro SIREN (9 chiffres) pour le nom du fichier légal.');
            return;
        }
        const annee = new Date(dateFin).getFullYear();
        const { content, filename } = genererFEC(ecritures, siren.trim(), annee);
        telechargerFichier(content, filename, 'text/plain;charset=utf-8');
    }

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1>Journaux comptables & Export FEC</h1>
                    <p>Journaux auxiliaires (VE, AC, BQ, OD) et export légal obligatoire pour le fisc</p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--primary" onClick={handleTelechargerFEC}>
                        📁 Télécharger le FEC légal (.txt)
                    </button>
                    <button className="btn btn--ghost" onClick={() => window.print()}>
                        🖨️ Imprimer
                    </button>
                </div>
            </div>

            {/* Avertissement FEC */}
            <div className="notice notice--info" style={{ marginBottom: 20 }}>
                <span>
                    <strong>Conformité fiscale française :</strong> Le Fichier des Écritures Comptables (FEC) est le format informatique officiel requis en cas de contrôle fiscal (art. L. 47 A-I du LPF). Il contient les 18 colonnes normalisées de chaque écriture (Journal, N° d'écriture, Date, Compte, Libellé, Débit, Crédit, Référence de pièce).
                </span>
            </div>

            {/* Filtres & Configuration SIREN */}
            <div className="card" style={{ padding: '14px 20px', marginBottom: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'end' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 12 }}>Journal</label>
                        <select
                            className="form-select"
                            value={codeJournal}
                            onChange={(e) => setCodeJournal(e.target.value)}
                        >
                            {JOURNAUX.map((j) => (
                                <option key={j.code} value={j.code}>{j.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 12 }}>Date début</label>
                        <input
                            type="date"
                            className="form-input"
                            value={dateDebut}
                            onChange={(e) => setDateDebut(e.target.value)}
                        />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 12 }}>Date fin</label>
                        <input
                            type="date"
                            className="form-input"
                            value={dateFin}
                            onChange={(e) => setDateFin(e.target.value)}
                        />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 12 }}>SIREN de la société</label>
                        <input
                            type="text"
                            maxLength={9}
                            className="form-input"
                            value={siren}
                            onChange={(e) => setSiren(e.target.value)}
                            placeholder="Ex. 901234567"
                        />
                    </div>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                    {ecritures.length} écriture(s) trouvée(s) pour la période sélectionnée
                </div>
            </div>

            {/* Liste chronologique des écritures */}
            {ecritures.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    Aucune écriture comptable dans ce journal pour la période sélectionnée.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {ecritures.map((ec) => {
                        const totDebit = (ec.mouvements || []).reduce((s, m) => s + (m.debit || 0), 0);
                        const totCredit = (ec.mouvements || []).reduce((s, m) => s + (m.credit || 0), 0);

                        return (
                            <div key={ec.id} className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 0 }}>
                                {/* Barre d'en-tête de l'écriture */}
                                <div style={{
                                    padding: '10px 16px',
                                    background: 'var(--bg2)',
                                    borderBottom: '1px solid var(--border)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span className="badge badge--info">Journal {ec.journal}</span>
                                        <span style={{ fontSize: 12, fontWeight: 600 }}>{formatDate(ec.date)}</span>
                                        <span style={{ fontSize: 13, fontWeight: 500 }}>{ec.libelle}</span>
                                        {ec.pieceRef && <code style={{ fontSize: 11 }}>Réf: {ec.pieceRef}</code>}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                        ID : <code>{ec.id.slice(0, 8)}...</code>
                                    </div>
                                </div>

                                {/* Table des mouvements Débit / Crédit */}
                                <div className="table-wrap">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th style={{ width: 100 }}>N° Compte</th>
                                                <th>Libellé de la ligne</th>
                                                <th style={{ textAlign: 'right', width: 130 }}>Débit (€)</th>
                                                <th style={{ textAlign: 'right', width: 130 }}>Crédit (€)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(ec.mouvements || []).map((m, idx) => (
                                                <tr key={idx}>
                                                    <td><code>{m.compte}</code></td>
                                                    <td>{m.libelle || ec.libelle}</td>
                                                    <td style={{ textAlign: 'right', fontWeight: 500 }}>
                                                        {m.debit > 0 ? formatMontant(m.debit) : '—'}
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontWeight: 500 }}>
                                                        {m.credit > 0 ? formatMontant(m.credit) : '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ background: 'var(--bg3)', fontSize: 12 }}>
                                                <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600 }}>
                                                    Équilibre écriture :
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: 700 }}>
                                                    {formatMontant(totDebit)}
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: 700 }}>
                                                    {formatMontant(totCredit)}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
