/**
 * GrandLivre.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Grand Livre comptable légal (norme PCG).
 * Présente le détail exhaustif de tous les comptes mouvementés avec :
 * - Date, Journal, N° Pièce, Libellé de l'écriture
 * - Montants Débit et Crédit
 * - Solde progressif débiteur/créditeur pour chaque ligne
 * - Filtre par compte, mot-clé, journal et période
 * - Export CSV pour l'expert-comptable
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getEcrituresActives, calculerGrandLivre, telechargerFichier, hasEcrituresCache } from '../../services/comptaService';
import { formatMontant, formatDate, toISODate } from '../../services/helpers';
import { DateInput } from '../../components/common/DateInput';
import { ModalModifierOperation } from '../../components/ModalModifierOperation';

export default function GrandLivre() {
    const anneeCourante = new Date().getFullYear();
    const [dateDebut, setDateDebut] = useState(`${anneeCourante}-01-01`);
    const [dateFin, setDateFin] = useState(toISODate(new Date()));
    const [journalFiltre, setJournalFiltre] = useState('');
    const [compteFiltre, setCompteFiltre] = useState('');
    const [recherche, setRecherche] = useState('');
    const [ecritures, setEcritures] = useState([]);
    const [loading, setLoading] = useState(() => !hasEcrituresCache());
    const [selectedEcritureId, setSelectedEcritureId] = useState(null);

    const loadData = useCallback(async () => {
        if (!hasEcrituresCache()) {
            setLoading(true);
        }
        try {
            const data = await getEcrituresActives({ dateDebut, dateFin, journal: journalFiltre || undefined });
            setEcritures(data);
        } catch (err) {
            console.error('Erreur chargement écritures pour Grand Livre:', err);
        } finally {
            setLoading(false);
        }
    }, [dateDebut, dateFin, journalFiltre]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const grandLivre = useMemo(() => {
        return calculerGrandLivre(ecritures);
    }, [ecritures]);

    // Filtrage par compte et recherche
    const grandLivreFiltre = useMemo(() => {
        return grandLivre.filter((c) => {
            if (compteFiltre && c.compte !== compteFiltre) return false;
            if (recherche) {
                const q = recherche.toLowerCase();
                const matchCompte = c.compte.toLowerCase().includes(q) || c.intitule.toLowerCase().includes(q);
                const matchLigne = c.lignes.some((l) => (l.libelle || '').toLowerCase().includes(q) || (l.pieceRef || '').toLowerCase().includes(q));
                if (!matchCompte && !matchLigne) return false;
            }
            return true;
        });
    }, [grandLivre, compteFiltre, recherche]);

    // Totaux globaux
    const totalDebitGlobal = grandLivreFiltre.reduce((s, c) => s + c.totalDebit, 0);
    const totalCreditGlobal = grandLivreFiltre.reduce((s, c) => s + c.totalCredit, 0);

    // Export CSV du Grand Livre
    function exporterCSV() {
        const headers = ['Compte', 'Intitule', 'Date', 'Journal', 'Piece', 'Libelle', 'Debit', 'Credit', 'Solde_Progressif'];
        const rows = [headers.join(';')];

        grandLivreFiltre.forEach((c) => {
            c.lignes.forEach((l) => {
                const dateStr = l.date ? formatDate(l.date) : '';
                const row = [
                    `"${c.compte}"`,
                    `"${c.intitule.replace(/"/g, '""')}"`,
                    dateStr,
                    l.journal,
                    `"${(l.pieceRef || '').replace(/"/g, '""')}"`,
                    `"${(l.libelle || '').replace(/"/g, '""')}"`,
                    (l.debit || 0).toFixed(2).replace('.', ','),
                    (l.credit || 0).toFixed(2).replace('.', ','),
                    (l.soldeProgressif || 0).toFixed(2).replace('.', ','),
                ];
                rows.push(row.join(';'));
            });
        });

        telechargerFichier(rows.join('\r\n'), `GrandLivre_${dateDebut}_${dateFin}.csv`, 'text/csv;charset=utf-8');
    }

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1>Grand livre général</h1>
                    <p>Ensemble des écritures et mouvements détaillés par compte comptable</p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--ghost" onClick={exporterCSV}>
                        Exporter en CSV
                    </button>
                    <button className="btn btn--ghost" onClick={() => window.print()}>
                        Imprimer / PDF
                    </button>
                </div>
            </div>

            {/* Bannière de période visible uniquement à l'impression */}
            <div className="print-only" style={{ marginBottom: 16, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                Période d'exercice : du {formatDate(dateDebut)} au {formatDate(dateFin)}
            </div>

            {/* Filtres */}
            <div className="card no-print" style={{ padding: '14px 20px', marginBottom: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'end' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 12 }}>Période du</label>
                        <DateInput
                            className="form-input"
                            value={dateDebut}
                            onChange={(e) => setDateDebut(e.target.value)}
                        />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 12 }}>Au</label>
                        <DateInput
                            className="form-input"
                            value={dateFin}
                            onChange={(e) => setDateFin(e.target.value)}
                        />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 12 }}>Filtrer par compte</label>
                        <select
                            className="form-select"
                            value={compteFiltre}
                            onChange={(e) => setCompteFiltre(e.target.value)}
                        >
                            <option value="">Tous les comptes ({grandLivre.length})</option>
                            {grandLivre.map((c) => (
                                <option key={c.compte} value={c.compte}>
                                    {c.compte} — {c.intitule}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: 12 }}>Journal</label>
                        <select
                            className="form-select"
                            value={journalFiltre}
                            onChange={(e) => setJournalFiltre(e.target.value)}
                        >
                            <option value="">Tous les journaux</option>
                            <option value="VE">VE — Journal des Ventes</option>
                            <option value="AC">AC — Journal des Achats</option>
                            <option value="BQ">BQ — Journal de Banque</option>
                            <option value="OD">OD — Opérations Diverses</option>
                        </select>
                    </div>
                </div>

                <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                    <input
                        type="text"
                        className="form-input"
                        placeholder="Recherche dans les libellés, numéros de pièces ou comptes..."
                        value={recherche}
                        onChange={(e) => setRecherche(e.target.value)}
                        style={{ flex: 1 }}
                    />
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {grandLivreFiltre.length} compte(s) affiché(s) · {ecritures.length} écritures
                    </div>
                </div>
            </div>

            {/* Liste des comptes du Grand Livre */}
            {grandLivreFiltre.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    Aucun compte mouvementé pour les critères sélectionnés.
                </div>
            ) : (
                grandLivreFiltre.map((compte) => {
                    const soldeDeb = compte.soldeDebiteur;
                    const soldeCred = compte.soldeCrediteur;

                    return (
                        <div key={compte.compte} className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
                            {/* En-tête du compte */}
                            <div style={{
                                padding: '12px 18px',
                                background: 'var(--bg2)',
                                borderBottom: '1px solid var(--border)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}>
                                <div>
                                    <span style={{ fontSize: 15, fontWeight: 700, marginRight: 8 }}>
                                        <code>{compte.compte}</code> {compte.intitule}
                                    </span>
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                        ({compte.lignes.length} mouvement{compte.lignes.length > 1 ? 's' : ''})
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
                                    <span>Débit : <strong>{formatMontant(compte.totalDebit)}</strong></span>
                                    <span>Crédit : <strong>{formatMontant(compte.totalCredit)}</strong></span>
                                    <span style={{
                                        fontWeight: 700,
                                        color: soldeDeb > 0 ? 'var(--accent)' : soldeCred > 0 ? 'var(--success)' : 'var(--text-muted)'
                                    }}>
                                        Solde : {soldeDeb > 0 ? `${formatMontant(soldeDeb)} (Débiteur)` : soldeCred > 0 ? `${formatMontant(soldeCred)} (Créditeur)` : '0,00 €'}
                                    </span>
                                </div>
                            </div>

                            {/* Table des mouvements du compte */}
                            <div className="table-wrap">
                                <table>
                                    <thead>
                                        <tr>
                                            <th style={{ width: 90 }}>Date</th>
                                            <th style={{ width: 60 }}>Journal</th>
                                            <th style={{ width: 100 }}>Pièce</th>
                                            <th>Libellé de l'écriture</th>
                                            <th style={{ textAlign: 'right', width: 110 }}>Débit</th>
                                            <th style={{ textAlign: 'right', width: 110 }}>Crédit</th>
                                            <th style={{ textAlign: 'right', width: 120 }}>Solde progressif</th>
                                            <th style={{ textAlign: 'center', width: 44 }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {compte.lignes.map((l, idx) => (
                                            <tr
                                                key={idx}
                                                onClick={() => setSelectedEcritureId(l.ecritureId)}
                                                style={{ cursor: 'pointer', transition: 'background var(--transition)' }}
                                                className="table-row--interactive"
                                                title="Cliquer pour voir le détail de l'écriture et ses pièces justificatives"
                                            >
                                                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDate(l.date)}</td>
                                                <td><span className="badge badge--muted">{l.journal}</span></td>
                                                <td style={{ fontSize: 12 }}><code>{l.pieceRef}</code></td>
                                                <td>
                                                    <span>{l.libelle}</span>
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: 500 }}>
                                                    {l.debit > 0 ? formatMontant(l.debit) : '—'}
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: 500 }}>
                                                    {l.credit > 0 ? formatMontant(l.credit) : '—'}
                                                </td>
                                                <td style={{
                                                    textAlign: 'right',
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    color: l.soldeProgressif > 0 ? 'var(--accent)' : l.soldeProgressif < 0 ? 'var(--success)' : 'var(--text-muted)'
                                                }}>
                                                    {formatMontant(Math.abs(l.soldeProgressif))} {l.soldeProgressif >= 0 ? 'D' : 'C'}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <button
                                                        type="button"
                                                        style={{
                                                            background: 'transparent',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            fontSize: 18,
                                                            color: 'var(--text-muted)',
                                                            padding: '2px 6px',
                                                            borderRadius: 4,
                                                            lineHeight: 1,
                                                        }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedEcritureId(l.ecritureId);
                                                        }}
                                                        title="Options (Modifier)"
                                                    >
                                                        ⋮
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ fontWeight: 700 }}>
                                            <td colSpan={4}>TOTAL DU COMPTE {compte.compte}</td>
                                            <td style={{ textAlign: 'right' }}>{formatMontant(compte.totalDebit)}</td>
                                            <td style={{ textAlign: 'right' }}>{formatMontant(compte.totalCredit)}</td>
                                            <td style={{ textAlign: 'right', color: soldeDeb > 0 ? 'var(--accent)' : 'var(--success)' }}>
                                                {soldeDeb > 0 ? formatMontant(soldeDeb) : formatMontant(soldeCred)}
                                            </td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    );
                })
            )}

            {/* Récapitulatif général en bas de page */}
            <div className="card" style={{ background: 'var(--bg2)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <strong>TOTAL GÉNÉRAL DU GRAND LIVRE SÉLECTIONNÉ</strong>
                <div style={{ display: 'flex', gap: 20, fontSize: 14 }}>
                    <span>Total Débits : <strong>{formatMontant(totalDebitGlobal)}</strong></span>
                    <span>Total Crédits : <strong>{formatMontant(totalCreditGlobal)}</strong></span>
                </div>
            </div>

            {/* Modal de modification de l'opération */}
            {selectedEcritureId && (
                <ModalModifierOperation
                    ecritureId={selectedEcritureId}
                    onClose={() => setSelectedEcritureId(null)}
                    onSaved={() => {
                        setSelectedEcritureId(null);
                        loadData();
                    }}
                />
            )}
        </div>
    );
}
