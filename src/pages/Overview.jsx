/**
 * Overview.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Page d'accueil / Tableau de bord financier sobre et efficace :
 * - Trésorerie disponible actuelle (Banque compte 512)
 * - Indicateurs financiers clés (CA, Charges, Résultat net, Créances clients, Dettes CCA)
 * - Dernières transactions et flux financiers récents
 * - Synthèse des comptes courants d'associés (CCA)
 * - Accès rapide aux actions quotidiennes
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { getEcrituresActives, calculerGrandLivre, calculerCompteResultat } from '../services/comptaService';
import { formatMontant, formatDate } from '../services/helpers';
import { getCached, setCached } from '../services/dataCache';
import { ModalModifierOperation } from '../components/ModalModifierOperation';

export default function Overview() {
    const navigate = useNavigate();
    const [ecritures, setEcritures] = useState(() => getCached('overview_ecritures') || []);
    const [associes, setAssocies] = useState(() => getCached('associes') || []);
    const [ccaMouvements, setCcaMouvements] = useState(() => getCached('ccaMouvements') || []);
    const [avances, setAvances] = useState(() => getCached('avancesFrags') || []);
    const [clients, setClients] = useState(() => getCached('clients') || []);
    const [depenses, setDepenses] = useState(() => getCached('depenses') || []);
    const [loading, setLoading] = useState(() => !getCached('overview_ecritures'));
    const [selectedEcritureId, setSelectedEcritureId] = useState(null);

    const anneeCourante = new Date().getFullYear();

    const loadData = useCallback(async () => {
        if (!getCached('overview_ecritures')) {
            setLoading(true);
        }
        try {
            const [ecrData, assSnap, ccaSnap, avSnap, cliSnap, depSnap] = await Promise.all([
                getEcrituresActives({ dateDebut: `${anneeCourante}-01-01` }),
                getDocs(collection(db, 'associes')),
                getDocs(collection(db, 'ccaMouvements')),
                getDocs(collection(db, 'avancesFrags')),
                getDocs(collection(db, 'clients')),
                getDocs(collection(db, 'depenses')),
            ]);

            const assList = assSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const ccaList = ccaSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const avList = avSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const cliList = cliSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const depList = depSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

            setEcritures(ecrData);
            setAssocies(assList);
            setCcaMouvements(ccaList);
            setAvances(avList);
            setClients(cliList);
            setDepenses(depList);

            setCached('overview_ecritures', ecrData);
            setCached('associes', assList);
            setCached('ccaMouvements', ccaList);
            setCached('avancesFrags', avList);
            setCached('clients', cliList);
            setCached('depenses', depList);
        } catch (err) {
            console.error('Erreur chargement Overview:', err);
        } finally {
            setLoading(false);
        }
    }, [anneeCourante]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // ─── Calculs financiers en temps réel ───
    const grandLivre = useMemo(() => calculerGrandLivre(ecritures), [ecritures]);
    const compteResultat = useMemo(() => calculerCompteResultat(ecritures), [ecritures]);

    // 1. Trésorerie disponible (Compte 512 Banque)
    const tresorerieBanque = useMemo(() => {
        const c512 = grandLivre.find((c) => c.compte === '512');
        if (!c512) return 0;
        return +(c512.totalDebit - c512.totalCredit).toFixed(2);
    }, [grandLivre]);

    // 2. Chiffre d'affaires (Produits classe 7)
    const chiffreAffaires = compteResultat.produits.totalGlobal;

    // 3. Charges totales (Classe 6)
    const chargesTotales = compteResultat.charges.totalGlobal;

    // 4. Résultat net de l'exercice
    const resultatNet = compteResultat.sig.resultatNet;
    const estBenefice = compteResultat.sig.estBenefice;

    // 5. Créances clients non encaissées (Comptes 411)
    const creancesClients = useMemo(() => {
        const c411 = grandLivre.filter((c) => c.compte.startsWith('411'));
        return +c411.reduce((s, c) => s + c.soldeDebiteur, 0).toFixed(2);
    }, [grandLivre]);

    // 6. Dettes CCA (Comptes 455x)
    const dettesCCA = useMemo(() => {
        const c455 = grandLivre.filter((c) => c.compte.startsWith('455'));
        return +c455.reduce((s, c) => s + c.soldeCrediteur, 0).toFixed(2);
    }, [grandLivre]);

    // 7. Ventilation analytique des dépenses par activité (Wheeloh vs site-chateau.fr vs Commun)
    const ventilationActivites = useMemo(() => {
        let totalWheeloh = 0;
        let totalSiteChateau = 0;
        let totalCommun = 0;

        depenses.forEach((d) => {
            const m = d.montant || 0;
            if (d.activite === 'site-chateau') totalSiteChateau += m;
            else if (d.activite === 'commun') totalCommun += m;
            else totalWheeloh += m;
        });

        const totalGlobal = totalWheeloh + totalSiteChateau + totalCommun;
        const pctWheeloh = totalGlobal > 0 ? Math.round((totalWheeloh / totalGlobal) * 100) : 0;
        const pctSiteChateau = totalGlobal > 0 ? Math.round((totalSiteChateau / totalGlobal) * 100) : 0;
        const pctCommun = totalGlobal > 0 ? Math.max(0, 100 - pctWheeloh - pctSiteChateau) : 0;

        return {
            wheeloh: +totalWheeloh.toFixed(2),
            siteChateau: +totalSiteChateau.toFixed(2),
            commun: +totalCommun.toFixed(2),
            totalGlobal: +totalGlobal.toFixed(2),
            pctWheeloh,
            pctSiteChateau,
            pctCommun,
        };
    }, [depenses]);

    // ─── Dernières transactions chronologiques ───
    const dernieresTransactions = useMemo(() => {
        // Prendre les écritures les plus récentes triées par date décroissante
        const sorted = [...ecritures].sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
        const recent = sorted.slice(0, 15);

        return recent.map((ec) => {
            // Analyser la nature et l'impact de l'écriture
            let impactTresorerie = 0;
            let typeLabel = 'Opération';
            let typeBadge = 'badge--muted';

            // Mouvements sur 512
            const mvtBanque = (ec.mouvements || []).find((m) => String(m.compte).trim() === '512');
            if (mvtBanque) {
                if (mvtBanque.debit > 0) {
                    impactTresorerie = +mvtBanque.debit;
                } else if (mvtBanque.credit > 0) {
                    impactTresorerie = -mvtBanque.credit;
                }
            } else {
                // Écriture hors banque (ex: facture émise, note de frais OD)
                const mvtCharge = (ec.mouvements || []).find((m) => String(m.compte).startsWith('6'));
                const mvtProduit = (ec.mouvements || []).find((m) => String(m.compte).startsWith('7'));
                if (mvtCharge) impactTresorerie = -mvtCharge.debit;
                else if (mvtProduit) impactTresorerie = +mvtProduit.credit;
                else {
                    impactTresorerie = (ec.mouvements || [])[0]?.debit || 0;
                }
            }

            // Type explicite
            const src = ec.sourceType || '';
            if (src.includes('facture') || ec.journal === 'VE') {
                typeLabel = 'Recette / Vente';
                typeBadge = 'badge--success';
            } else if (src.includes('depense') || ec.journal === 'AC') {
                typeLabel = 'Dépense';
                typeBadge = 'badge--warning';
            } else if (src.includes('cca_apport')) {
                typeLabel = 'Apport CCA';
                typeBadge = 'badge--info';
            } else if (src.includes('cca_remboursement')) {
                typeLabel = 'Remboursement CCA';
                typeBadge = 'badge--info';
            } else if (src.includes('cca_interets')) {
                typeLabel = 'Intérêts CCA';
                typeBadge = 'badge--warning';
            } else if (src.includes('avance')) {
                typeLabel = 'Avance frais';
                typeBadge = 'badge--warning';
            } else if (src.includes('dividende')) {
                typeLabel = 'Dividende';
                typeBadge = 'badge--muted';
            } else if (ec.journal === 'BQ') {
                typeLabel = 'Virement bancaire';
                typeBadge = 'badge--info';
            }

            return {
                id: ec.id,
                date: ec.dateObj,
                journal: ec.journal,
                libelle: ec.libelle,
                pieceRef: ec.pieceRef || ec.id.slice(0, 6),
                typeLabel,
                typeBadge,
                montant: Math.abs(impactTresorerie),
                isPositive: impactTresorerie >= 0,
            };
        });
    }, [ecritures]);

    // ─── Synthèse rapide CCA par associé ───
    const syntheseAssocies = useMemo(() => {
        return associes.filter((a) => a.actif).map((a) => {
            const mvts = ccaMouvements.filter((m) => m.associeId === a.id);
            const apports = mvts.filter((m) => m.type === 'apport').reduce((s, m) => s + (m.montant || 0), 0);
            const remb = mvts.filter((m) => m.type === 'remboursement').reduce((s, m) => s + (m.montant || 0), 0);
            const interets = mvts.filter((m) => m.type === 'interets').reduce((s, m) => s + (m.montant || 0), 0);

            const avA = avances.filter((av) => av.associeId === a.id && av.statut === 'a_rembourser');
            const avNonRemb = avA.reduce((s, av) => s + (av.montant || 0), 0);

            const solde = +(apports + avNonRemb + interets - remb).toFixed(2);
            return {
                id: a.id,
                nom: `${a.nom} ${a.prenom || ''}`.trim(),
                parts: a.pourcentageParts,
                compteCC: a.compteCC || '455',
                solde,
            };
        });
    }, [associes, ccaMouvements, avances]);

    if (loading) {
        return (
            <div>
                <div className="page-header">
                    <div>
                        <h1>Vue d'ensemble</h1>
                        <p>Chargement des données comptables...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Header sobre */}
            <div className="page-header">
                <div>
                    <h1>Vue d'ensemble</h1>
                    <p>Situation financière, trésorerie et flux récents — Exercice {anneeCourante}</p>
                </div>
                <div className="page-header__actions">
                    <button className="btn btn--primary" onClick={() => navigate('/facturation/nouvelle')}>
                        + Facture client
                    </button>
                    <button className="btn btn--ghost" onClick={() => navigate('/depenses/nouvelle')}>
                        + Dépense
                    </button>
                    <button className="btn btn--ghost" onClick={() => navigate('/associes/cca')}>
                        + Mouvement CCA
                    </button>
                </div>
            </div>

            {/* Bloc Trésorerie principale */}
            <div className="card" style={{ padding: '20px 24px', marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>
                            Trésorerie disponible (Compte 512 — Banque)
                        </div>
                        <div style={{ fontSize: 32, fontWeight: 800, color: tresorerieBanque >= 0 ? '#0f172a' : 'var(--danger)', letterSpacing: '-0.5px' }}>
                            {formatMontant(tresorerieBanque)}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                            {tresorerieBanque >= 0 ? 'Solde bancaire créditeur disponible' : 'Découvert bancaire'} · Actualisé en temps réel
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10, alignSelf: 'center' }}>
                        <button className="btn btn--ghost btn--sm" onClick={() => navigate('/compta/bilan')}>
                            Consulter le Bilan →
                        </button>
                        <button className="btn btn--ghost btn--sm" onClick={() => navigate('/compta/grand-livre')}>
                            Grand Livre (512) →
                        </button>
                    </div>
                </div>
            </div>

            {/* Grille des indicateurs clés (4 cartes sobres) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                        Chiffre d'affaires
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                        {formatMontant(chiffreAffaires)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        Produits encaissés / facturés
                    </div>
                </div>

                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                        Charges de l'exercice
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                        {formatMontant(chargesTotales)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        Achats, services & frais
                    </div>
                </div>

                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                        Résultat net estimé
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: estBenefice ? 'var(--success)' : 'var(--danger)' }}>
                        {formatMontant(resultatNet)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        {estBenefice ? 'Bénéfice net' : 'Déficit net'}
                    </div>
                </div>

                <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                        Créances clients (411)
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                        {formatMontant(creancesClients)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        Règlements en attente
                    </div>
                </div>
            </div>

            {/* ─── Ventilation analytique des dépenses : Wheeloh vs site-chateau.fr ─── */}
            <div className="card" style={{ padding: '18px 22px', marginBottom: 24, borderLeft: '4px solid #2563eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>📊</span> Répartition analytique des charges par activité
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            Ventilation interne de gestion · Votre comptabilité générale officielle (Bilan, Compte de résultat, Grand Livre) reste 100% consolidée.
                        </div>
                    </div>
                    <button
                        className="btn btn--sm btn--ghost"
                        onClick={() => navigate('/depenses')}
                    >
                        Gérer les dépenses →
                    </button>
                </div>

                {ventilationActivites.totalGlobal > 0 ? (
                    <>
                        {/* Barre visuelle de proportion */}
                        <div style={{
                            display: 'flex',
                            height: 10,
                            borderRadius: 5,
                            overflow: 'hidden',
                            backgroundColor: 'var(--bg3)',
                            marginBottom: 16,
                        }}>
                            {ventilationActivites.pctWheeloh > 0 && (
                                <div style={{ width: `${ventilationActivites.pctWheeloh}%`, backgroundColor: '#2563eb' }} title={`Wheeloh : ${ventilationActivites.pctWheeloh}%`} />
                            )}
                            {ventilationActivites.pctSiteChateau > 0 && (
                                <div style={{ width: `${ventilationActivites.pctSiteChateau}%`, backgroundColor: '#9333ea' }} title={`site-chateau.fr : ${ventilationActivites.pctSiteChateau}%`} />
                            )}
                            {ventilationActivites.pctCommun > 0 && (
                                <div style={{ width: `${ventilationActivites.pctCommun}%`, backgroundColor: '#94a3b8' }} title={`Commun : ${ventilationActivites.pctCommun}%`} />
                            )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                            <div style={{ background: 'var(--bg2)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1d4ed8' }}>🚲 Wheeloh</span>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>{ventilationActivites.pctWheeloh}%</span>
                                </div>
                                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                                    {formatMontant(ventilationActivites.wheeloh)}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                    Activité mobilité & vélos
                                </div>
                            </div>

                            <div style={{ background: 'var(--bg2)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: '#7e22ce' }}>🏰 site-chateau.fr</span>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#7e22ce' }}>{ventilationActivites.pctSiteChateau}%</span>
                                </div>
                                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                                    {formatMontant(ventilationActivites.siteChateau)}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                    Projet site château
                                </div>
                            </div>

                            <div style={{ background: 'var(--bg2)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>🏢 Frais généraux</span>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>{ventilationActivites.pctCommun}%</span>
                                </div>
                                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
                                    {formatMontant(ventilationActivites.commun)}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                    Frais bancaires, administratifs, etc.
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', padding: '6px 0' }}>
                        Aucune dépense enregistrée. Enregistrez des dépenses pour visualiser la part de chaque activité en temps réel.
                    </div>
                )}
            </div>

            {/* Deux colonnes : Dernières transactions (large) + Synthèse CCA / Raccourcis (étroit) */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, alignItems: 'start' }}>

                {/* ─── Colonne 1 : Dernières transactions ─── */}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{
                        padding: '16px 20px',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                                Dernières opérations comptables
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                💡 Cliquez sur une opération pour afficher sa partie double et ses justificatifs
                            </div>
                        </div>
                        <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => navigate('/compta/journaux')}
                        >
                            Voir tous les journaux →
                        </button>
                    </div>

                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th style={{ width: 85 }}>Date</th>
                                    <th>Libellé / Tiers</th>
                                    <th style={{ width: 130 }}>Type</th>
                                    <th style={{ textAlign: 'right', width: 120 }}>Montant</th>
                                    <th style={{ textAlign: 'center', width: 85 }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dernieresTransactions.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>
                                            Aucune transaction enregistrée pour le moment.
                                        </td>
                                    </tr>
                                ) : (
                                    dernieresTransactions.map((tx) => (
                                        <tr
                                            key={tx.id}
                                            onClick={() => setSelectedEcritureId(tx.id)}
                                            style={{ cursor: 'pointer', transition: 'background var(--transition)' }}
                                            className="table-row--interactive"
                                            title="Cliquer pour voir le détail complet et les pièces justificatives"
                                        >
                                            <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                                {formatDate(tx.date)}
                                            </td>
                                            <td>
                                                <div>
                                                    <div style={{ fontWeight: 500, fontSize: 13 }}>{tx.libelle}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-light)' }}>
                                                        Journal {tx.journal} · Réf: {tx.pieceRef}
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`badge ${tx.typeBadge}`}>{tx.typeLabel}</span>
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 13, color: tx.isPositive ? 'var(--success)' : 'var(--text)' }}>
                                                {tx.isPositive ? `+ ${formatMontant(tx.montant)}` : `- ${formatMontant(tx.montant)}`}
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
                                                        setSelectedEcritureId(tx.id);
                                                    }}
                                                    title="Options (Modifier)"
                                                >
                                                    ⋮
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ─── Colonne 2 : Comptes Courants d'Associés & État du système ─── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* Carte Comptes Courants (CCA) */}
                    <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                                Comptes Courants (CCA)
                            </div>
                            <button
                                className="btn btn--sm btn--ghost"
                                onClick={() => navigate('/associes/cca')}
                            >
                                Gérer
                            </button>
                        </div>

                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                            Total dû aux associés : <strong style={{ color: 'var(--text)' }}>{formatMontant(dettesCCA)}</strong>
                        </div>

                        {syntheseAssocies.length === 0 ? (
                            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aucun associé enregistré.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {syntheseAssocies.map((a) => (
                                    <div
                                        key={a.id}
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: '8px 10px',
                                            background: 'var(--bg2)',
                                            borderRadius: 'var(--radius)',
                                            fontSize: 12,
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontWeight: 500 }}>{a.nom}</div>
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                Compte <code>{a.compteCC}</code> · {a.parts}%
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right', fontWeight: 600, color: a.solde > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                                            {formatMontant(a.solde)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Carte État comptable & Conformité */}
                    <div className="card" style={{ padding: '16px 20px', marginBottom: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
                            Contrôle de conformité
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>Équilibre comptable</span>
                                <span className="badge badge--success">Équilibré (Débit = Crédit)</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>Écritures enregistrées</span>
                                <span style={{ fontWeight: 600 }}>{ecritures.length} actives</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>Clients enregistrés</span>
                                <span style={{ fontWeight: 600 }}>{clients.length} clients</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>Fichier FEC</span>
                                <span className="badge badge--info">Normalisé Art. A.47 A-1</span>
                            </div>
                        </div>

                        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                            <button
                                className="btn btn--ghost btn--sm"
                                style={{ width: '100%', justifyContent: 'center' }}
                                onClick={() => navigate('/compta/balance')}
                            >
                                Voir la Balance Générale →
                            </button>
                        </div>
                    </div>

                </div>

            </div>

            {/* Modal de modification d'opération */}
            {selectedEcritureId && (
                <ModalModifierOperation
                    ecritureId={selectedEcritureId}
                    onClose={() => setSelectedEcritureId(null)}
                    onSaved={() => {
                        setSelectedEcritureId(null);
                        loadData(true);
                    }}
                />
            )}
        </div>
    );
}
