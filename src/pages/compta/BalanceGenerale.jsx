/**
 * BalanceGenerale.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Balance Générale à 6 colonnes (norme comptable PCG) :
 * 1. N° Compte
 * 2. Intitulé du compte
 * 3. Total Débit
 * 4. Total Crédit
 * 5. Solde Débiteur
 * 6. Solde Créditeur
 * Avec contrôle strict de la double égalité :
 *   Total Débits == Total Crédits
 *   Total Soldes Débiteurs == Total Soldes Créditeurs
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getEcrituresActives, calculerBalance, telechargerFichier } from '../../services/comptaService';
import { formatMontant } from '../../services/helpers';

export default function BalanceGenerale() {
    const anneeCourante = new Date().getFullYear();
    const [dateDebut, setDateDebut] = useState(`${anneeCourante}-01-01`);
    const [dateFin, setDateFin] = useState(new Date().toISOString().split('T')[0]);
    const [classeFiltre, setClasseFiltre] = useState(''); // '' | '1' | '2' | '3' | '4' | '5' | '6' | '7'
    const [ecritures, setEcritures] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getEcrituresActives({ dateDebut, dateFin });
            setEcritures(data);
        } catch (err) {
            console.error('Erreur chargement écritures pour Balance:', err);
        } finally {
            setLoading(false);
        }
    }, [dateDebut, dateFin]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const balance = useMemo(() => {
        return calculerBalance(ecritures);
    }, [ecritures]);

    const lignesFiltrees = useMemo(() => {
        if (!classeFiltre) return balance.lignes;
        return balance.lignes.filter((l) => l.compte.startsWith(classeFiltre));
    }, [balance.lignes, classeFiltre]);

    // Totaux filtrés
    const totauxFiltres = useMemo(() => {
        const totalDebit = +lignesFiltrees.reduce((s, l) => s + l.totalDebit, 0).toFixed(2);
        const totalCredit = +lignesFiltrees.reduce((s, l) => s + l.totalCredit, 0).toFixed(2);
        const totalSoldeDebiteur = +lignesFiltrees.reduce((s, l) => s + l.soldeDebiteur, 0).toFixed(2);
        const totalSoldeCrediteur = +lignesFiltrees.reduce((s, l) => s + l.soldeCrediteur, 0).toFixed(2);
        return { totalDebit, totalCredit, totalSoldeDebiteur, totalSoldeCrediteur };
    }, [lignesFiltrees]);

    function exporterCSV() {
        const headers = ['Compte', 'Intitule', 'Total_Debit', 'Total_Credit', 'Solde_Debiteur', 'Solde_Crediteur'];
        const rows = [headers.join(';')];

        lignesFiltrees.forEach((l) => {
            const row = [
                `"${l.compte}"`,
                `"${l.intitule.replace(/"/g, '""')}"`,
                (l.totalDebit || 0).toFixed(2).replace('.', ','),
                (l.totalCredit || 0).toFixed(2).replace('.', ','),
                (l.soldeDebiteur || 0).toFixed(2).replace('.', ','),
                (l.soldeCrediteur || 0).toFixed(2).replace('.', ','),
            ];
            rows.push(row.join(';'));
        });

        telechargerFichier(rows.join('\r\n'), `BalanceGenerale_${dateDebut}_${dateFin}.csv`, 'text/csv;charset=utf-8');
    }

    return (
        <div>
            {/* Header */}
            <div className="page-header">
                <div>
                    <h1>Balance générale</h1>
                    <p>Balance de vérification à 6 colonnes actualisée en temps réel</p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--ghost" onClick={exporterCSV}>
                        📥 Exporter en CSV
                    </button>
                    <button className="btn btn--ghost" onClick={() => window.print()}>
                        🖨️ Imprimer / PDF
                    </button>
                </div>
            </div>

            {/* Filtres de période et de classe */}
            <div className="card" style={{ padding: '14px 20px', marginBottom: 20 }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>Période :</span>
                        <input
                            type="date"
                            className="form-input"
                            style={{ width: 140 }}
                            value={dateDebut}
                            onChange={(e) => setDateDebut(e.target.value)}
                        />
                        <span>au</span>
                        <input
                            type="date"
                            className="form-input"
                            style={{ width: 140 }}
                            value={dateFin}
                            onChange={(e) => setDateFin(e.target.value)}
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>Classe :</span>
                        <select
                            className="form-select"
                            style={{ width: 220 }}
                            value={classeFiltre}
                            onChange={(e) => setClasseFiltre(e.target.value)}
                        >
                            <option value="">Toutes les classes (1 à 7)</option>
                            <option value="1">Classe 1 — Capitaux</option>
                            <option value="2">Classe 2 — Immobilisations</option>
                            <option value="3">Classe 3 — Stocks</option>
                            <option value="4">Classe 4 — Tiers (Clients, CCA, Fournisseurs)</option>
                            <option value="5">Classe 5 — Trésorerie & Banque</option>
                            <option value="6">Classe 6 — Charges</option>
                            <option value="7">Classe 7 — Produits</option>
                        </select>
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                        <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => {
                                setDateDebut(`${anneeCourante}-01-01`);
                                setDateFin(`${anneeCourante}-12-31`);
                            }}
                        >
                            Année {anneeCourante}
                        </button>
                    </div>
                </div>
            </div>

            {/* Bannière de concordance et équilibre */}
            {!classeFiltre && (
                <div className={`notice ${balance.totaux.equilibre ? 'notice--success' : 'notice--danger'}`} style={{ marginBottom: 20 }}>
                    {balance.totaux.equilibre ? (
                        <div>
                            <strong>✓ Concordance arithmétique parfaite :</strong>
                            <br />
                            • Total Débits ({formatMontant(balance.totaux.totalDebit)}) = Total Crédits ({formatMontant(balance.totaux.totalCredit)})
                            <br />
                            • Total Soldes Débiteurs ({formatMontant(balance.totaux.totalSoldeDebiteur)}) = Total Soldes Créditeurs ({formatMontant(balance.totaux.totalSoldeCrediteur)})
                        </div>
                    ) : (
                        <div>
                            <strong>⚠️ Déséquilibre dans les comptes :</strong>
                            Écart Débit/Crédit de {formatMontant(Math.abs(balance.totaux.ecartMouvements))}.
                        </div>
                    )}
                </div>
            )}

            {/* Table Balance à 6 colonnes */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th style={{ width: 90 }}>N° Compte</th>
                                <th>Intitulé du compte</th>
                                <th style={{ textAlign: 'right', width: 130 }}>Total Débits</th>
                                <th style={{ textAlign: 'right', width: 130 }}>Total Crédits</th>
                                <th style={{ textAlign: 'right', width: 130 }}>Solde Débiteur</th>
                                <th style={{ textAlign: 'right', width: 130 }}>Solde Créditeur</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lignesFiltrees.length === 0 ? (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                                        Aucun compte mouvementé sur cette période.
                                    </td>
                                </tr>
                            ) : (
                                lignesFiltrees.map((l) => (
                                    <tr key={l.compte}>
                                        <td><code>{l.compte}</code></td>
                                        <td style={{ fontWeight: 500 }}>{l.intitule}</td>
                                        <td style={{ textAlign: 'right' }}>{formatMontant(l.totalDebit)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatMontant(l.totalCredit)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: l.soldeDebiteur > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                                            {l.soldeDebiteur > 0 ? formatMontant(l.soldeDebiteur) : '—'}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: l.soldeCrediteur > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                                            {l.soldeCrediteur > 0 ? formatMontant(l.soldeCrediteur) : '—'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                        <tfoot>
                            <tr style={{ fontWeight: 700, fontSize: 13, background: 'var(--bg2)' }}>
                                <td colSpan={2}>
                                    TOTAL {classeFiltre ? `CLASSE ${classeFiltre}` : 'GÉNÉRAL DE LA BALANCE'}
                                </td>
                                <td style={{ textAlign: 'right' }}>{formatMontant(totauxFiltres.totalDebit)}</td>
                                <td style={{ textAlign: 'right' }}>{formatMontant(totauxFiltres.totalCredit)}</td>
                                <td style={{ textAlign: 'right', color: 'var(--accent)' }}>
                                    {formatMontant(totauxFiltres.totalSoldeDebiteur)}
                                </td>
                                <td style={{ textAlign: 'right', color: 'var(--success)' }}>
                                    {formatMontant(totauxFiltres.totalSoldeCrediteur)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
}
