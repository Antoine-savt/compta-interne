/**
 * Formulaire "Enregistrer une dépense"
 * 
 * Génère automatiquement les écritures comptables via la fonction garde-fou.
 */
import { useState, useEffect } from 'react';
import {
    collection, addDoc, serverTimestamp,
    getDocs, query, orderBy, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { ecrireEcriture } from '../services/api';
import { formatMontant, getSettings, prochaineEcheance, doitEtreFixe } from '../services/helpers';
import { Tooltip, ToggleSwitch, SelecteurFrequence } from './Shared';
import { FileUpload } from './FileUpload';

const TOOLTIP_TVA_DEP = `En franchise en base de TVA, vous ne récupérez pas la TVA sur vos achats. Laissez ce toggle désactivé. Si votre société passe au régime réel assujetti, vous pourrez déduire la TVA payée à vos fournisseurs.`;
const TOOLTIP_ATTENTE = `"À payer" : la facture fournisseur est reçue mais n'a pas encore été réglée. "Payée" : le virement ou paiement a été effectué.`;
const TOOLTIP_ANALYTIQUE = `Ce champ ne change pas les comptes comptables  il sert uniquement à regrouper les dépenses par client ou projet pour voir leur coût total.`;

export function NouvelleDepense({ onCreated }) {
    const { user } = useAuth();

    const [categories, setCategories] = useState([]);
    const [fournisseurs, setFournisseurs] = useState([]);
    const [clients, setClients] = useState([]);
    const [settings, setSettings] = useState({ statutTVA: 'franchise', tauxTVADefaut: 20 });

    const [fournNom, setFournNom] = useState('');
    const [fournId, setFournId] = useState('');
    const [nouveauFourn, setNouveauFourn] = useState(false);
    const [description, setDescription] = useState('');
    const [montant, setMontant] = useState('');
    const [categorieId, setCategorieId] = useState('');
    const [motif, setMotif] = useState('');
    const [tvaOn, setTvaOn] = useState(false);
    const [tauxTVA, setTauxTVA] = useState(20);
    const [clientProjetId, setClientProjetId] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [dejaPayee, setDejaPayee] = useState(false);
    const [datePaiement, setDatePaiement] = useState('');
    const [recurrence, setRecurrence] = useState({ type: 'ponctuel', intervalleNombre: 1, intervalleUnite: 'mois', montantFixe: false, occurrencesPassees: 0 });
    const [documentIds, setDocumentIds] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    useEffect(() => {
        getDocs(query(collection(db, 'categoriesDepense'), orderBy('ordre'))).then((s) =>
            setCategories(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
        getDocs(query(collection(db, 'fournisseurs'), orderBy('nom'))).then((s) =>
            setFournisseurs(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
        getDocs(query(collection(db, 'clients'), orderBy('nom'))).then((s) =>
            setClients(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
        getSettings().then((s) => {
            setSettings(s);
            setTvaOn(s.statutTVA === 'redevable');
            setTauxTVA(s.tauxTVADefaut ?? 20);
        });
    }, []);

    const categorie = categories.find((c) => c.id === categorieId);
    const montantNum = parseFloat(montant) || 0;
    const montantTVA = tvaOn ? +(montantNum * tauxTVA / 100 / (1 + tauxTVA / 100)).toFixed(2) : 0;
    const montantHT = tvaOn ? +(montantNum - montantTVA).toFixed(2) : montantNum;

    async function handleSubmit(e) {
        e.preventDefault();
        setError(''); setSaving(true);

        try {
            if (!categorieId || !categorie) { setError('Veuillez choisir une catégorie.'); setSaving(false); return; }
            if (!montantNum) { setError('Le montant est obligatoire.'); setSaving(false); return; }
            if (categorie.motifObligatoire && !motif.trim()) {
                // Avertir sans bloquer
                setError('  Motif non renseigné  la dépense sera difficile à justifier fiscalement. Vous pouvez continuer, mais c\'est recommandé de le remplir.');
            }

            // Créer/récupérer fournisseur
            let fId = fournId;
            let fNom = fournNom.trim() || 'Fournisseur inconnu';
            if (nouveauFourn && fournNom.trim()) {
                const ref = await addDoc(collection(db, 'fournisseurs'), { nom: fNom, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                fId = ref.id;
            }

            // Récupérer le nom du client/projet analytique
            const clientProjet = clients.find((c) => c.id === clientProjetId);

            // Écriture dépense (journal AC)
            const mvtsDepense = buildMouvementsDepense(montantHT, montantTVA, montantNum, tvaOn, categorie.compte, fNom);
            const { ecritureId: ecDep } = await ecrireEcriture({
                journal: 'AC',
                date,
                libelle: `${categorie.label}  ${description || fNom}`,
                sourceType: 'depense',
                mouvements: mvtsDepense,
            });

            // Écriture paiement (journal BQ) si déjà payée
            const ecriturePaiementIds = [];
            if (dejaPayee) {
                const mvtPay = [
                    { compte: '401', libelle: fNom, debit: montantNum, credit: 0 },
                    { compte: '512', libelle: 'Banque', debit: 0, credit: montantNum },
                ];
                const { ecritureId: ecPay } = await ecrireEcriture({
                    journal: 'BQ',
                    date: datePaiement || date,
                    libelle: `Paiement ${categorie.label}  ${fNom}`,
                    sourceType: 'depense',
                    mouvements: mvtPay,
                });
                ecriturePaiementIds.push(ecPay);
            }

            // Créer la dépense en Firestore
            const prochaine = recurrence.type === 'recurrent'
                ? prochaineEcheance(date, recurrence.intervalleNombre, recurrence.intervalleUnite)
                : null;

            const depRef = await addDoc(collection(db, 'depenses'), {
                fournisseurId: fId || null,
                fournisseurNom: fNom,
                description,
                montant: montantNum,
                categorieId,
                categorieLabel: categorie.label,
                categorieCompte: categorie.compte,
                motif: motif || null,
                clientProjetId: clientProjetId || null,
                clientProjetNom: clientProjet?.nom ?? null,
                dateDépense: new Date(date),
                statut: dejaPayee ? 'payee' : 'a_payer',
                datePaiement: dejaPayee ? new Date(datePaiement || date) : null,
                tvaDéductible: tvaOn,
                tauxTVA: tvaOn ? tauxTVA : null,
                montantHT: tvaOn ? montantHT : null,
                montantTVA: tvaOn ? montantTVA : null,
                recurrence: {
                    ...recurrence,
                    prochaineEcheance: prochaine,
                    montantFixe: recurrence.type === 'recurrent' ? doitEtreFixe(recurrence.occurrencesPassees) : false,
                },
                ecritureDepenseIds: [ecDep],
                ecriturePaiementIds,
                documentIds,
                createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            });

            // Lier les justificatifs
            for (const dId of documentIds) {
                await updateDoc(doc(db, 'documents', dId), { sourceId: depRef.id });
            }

            setDone(true);
            onCreated?.({ depenseId: depRef.id });
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    function reset() {
        setDone(false); setError(''); setDescription(''); setMontant(''); setCategorieId('');
        setMotif(''); setFournNom(''); setFournId(''); setDocumentIds([]); setDejaPayee(false);
    }

    if (done) return (
        <div className="notice notice--success">
             Dépense enregistrée avec succès !
            <button className="btn btn--sm btn--ghost" style={{ marginLeft: 12 }} onClick={reset}>
                Nouvelle dépense
            </button>
        </div>
    );

    return (
        <form onSubmit={handleSubmit}>
            <div className="page-header">
                <h1>Enregistrer une dépense</h1>
                <p>Choisissez une catégorie  les écritures comptables sont générées automatiquement.</p>
            </div>

            {error && <div className="notice notice--warning">{error}</div>}

            {/*  Catégorie  */}
            <div className="card">
                <div className="card__title"> Catégorie</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {categories.map((cat) => (
                        <button
                            key={cat.id}
                            type="button"
                            className={`btn ${categorieId === cat.id ? 'btn--primary' : 'btn--ghost'}`}
                            onClick={() => setCategorieId(cat.id)}
                            title={cat.infoFiscale}
                        >
                            {cat.label}
                            {cat.infoFiscale && ' '}
                            {cat.infoFiscale && <Tooltip text={cat.infoFiscale} />}
                        </button>
                    ))}
                </div>
                {categorie && (
                    <p className="form-hint" style={{ marginTop: 10 }}>
                        Compte comptable : <code>{categorie.compte}</code>
                    </p>
                )}
            </div>

            {/*  Fournisseur  */}
            <div className="card">
                <div className="card__title"> Fournisseur</div>
                <ToggleSwitch id="nouveau-fourn" label="Nouveau fournisseur" checked={nouveauFourn} onChange={setNouveauFourn} />
                {nouveauFourn ? (
                    <div className="form-group" style={{ marginTop: 10 }}>
                        <label className="form-label">Nom du fournisseur</label>
                        <input type="text" className="form-input" value={fournNom} onChange={(e) => setFournNom(e.target.value)} placeholder="Ex. OVH Cloud" />
                    </div>
                ) : (
                    <div className="form-group" style={{ marginTop: 10 }}>
                        <label className="form-label">Fournisseur existant</label>
                        <select className="form-select" value={fournId} onChange={(e) => { setFournId(e.target.value); const f = fournisseurs.find((x) => x.id === e.target.value); setFournNom(f?.nom ?? ''); }}>
                            <option value=""> Choisir ou laisser vide </option>
                            {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
                        </select>
                    </div>
                )}
            </div>

            {/*  Détails  */}
            <div className="card">
                <div className="card__title"> Détails</div>

                <div className="form-group">
                    <label className="form-label">Description</label>
                    <input type="text" className="form-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex. Renouvellement nom de domaine wheeloh.com" />
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Montant TTC ()</label>
                        <input type="number" min="0" step="0.01" className="form-input" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Date de la dépense</label>
                        <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                </div>

                {/* Motif (si catégorie l'exige) */}
                {categorie?.motifObligatoire && (
                    <div className="form-group">
                        <label className="form-label">
                            Motif
                            <Tooltip text="Pour les repas d'affaires, le motif (ex. 'Déjeuner de travail avec client Dupont') est indispensable pour justifier la déductibilité en cas de contrôle fiscal." />
                        </label>
                        <input
                            type="text"
                            className="form-input"
                            value={motif}
                            onChange={(e) => setMotif(e.target.value)}
                            placeholder="Ex. Déjeuner avec client Dupont  discussion contrat"
                            style={!motif ? { borderColor: 'var(--warning)' } : {}}
                        />
                        {!motif && <p className="form-error" style={{ color: 'var(--warning)' }}>  Recommandé  sans motif, la dépense sera difficile à justifier fiscalement.</p>}
                    </div>
                )}

                {/* Rattachement analytique */}
                <div className="form-group">
                    <label className="form-label">
                        Rattaché à un client / projet (optionnel)
                        <Tooltip text={TOOLTIP_ANALYTIQUE} />
                    </label>
                    <select className="form-select" value={clientProjetId} onChange={(e) => setClientProjetId(e.target.value)}>
                        <option value=""> Aucun </option>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                </div>
            </div>

            {/*  TVA  */}
            <div className="card">
                <div className="card__title">
                     TVA déductible
                    <Tooltip text={TOOLTIP_TVA_DEP} />
                </div>
                <ToggleSwitch id="tva-dep" label="TVA déductible" checked={tvaOn} onChange={setTvaOn} tooltip={TOOLTIP_TVA_DEP} />
                {tvaOn && (
                    <>
                        <div className="form-group" style={{ marginTop: 12 }}>
                            <label className="form-label">Taux TVA (%)</label>
                            <input type="number" className="form-input" style={{ width: 100 }} value={tauxTVA} onChange={(e) => setTauxTVA(parseFloat(e.target.value) || 20)} />
                        </div>
                        <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                            <span>HT : <strong style={{ color: 'var(--text)' }}>{formatMontant(montantHT)}</strong></span>
                            <span>TVA : <strong style={{ color: 'var(--text)' }}>{formatMontant(montantTVA)}</strong></span>
                        </div>
                    </>
                )}
            </div>

            {/*  Récurrence  */}
            <div className="card">
                <div className="card__title">
                     Récurrence
                    <Tooltip text="Si c'est une dépense qui revient régulièrement (abonnement, loyer, etc.), configurez ici la fréquence. L'app créera un rappel à chaque échéance." />
                </div>
                <SelecteurFrequence
                    value={recurrence}
                    onChange={setRecurrence}
                    occurrencesPassees={recurrence.occurrencesPassees ?? 0}
                />
            </div>

            {/*  Paiement  */}
            <div className="card">
                <div className="card__title"> Paiement</div>
                <ToggleSwitch id="deja-payee" label="Déjà payée" checked={dejaPayee} onChange={setDejaPayee} tooltip={TOOLTIP_ATTENTE} />
                {dejaPayee && (
                    <div className="form-group" style={{ marginTop: 10 }}>
                        <label className="form-label">Date de paiement</label>
                        <input type="date" className="form-input" style={{ width: 200 }} value={datePaiement} onChange={(e) => setDatePaiement(e.target.value)} />
                    </div>
                )}
            </div>

            {/*  Justificatifs  */}
            <div className="card">
                <div className="card__title"> Justificatifs</div>
                <FileUpload sourceType="depense" sourceId={null} onUploaded={({ documentId }) => setDocumentIds((p) => [...p, documentId])} />
            </div>

            <button type="submit" className="btn btn--primary" disabled={saving} style={{ minWidth: 180 }}>
                {saving ? 'Enregistrement' : ' Enregistrer la dépense'}
            </button>
        </form>
    );
}

//  Helpers 

function buildMouvementsDepense(montantHT, montantTVA, montantTTC, tvaOn, compte, fournisseurNom) {
    if (!tvaOn) {
        return [
            { compte, libelle: `Charge  ${fournisseurNom}`, debit: montantHT, credit: 0 },
            { compte: '401', libelle: fournisseurNom, debit: 0, credit: montantHT },
        ];
    }
    return [
        { compte, libelle: `Charge HT  ${fournisseurNom}`, debit: montantHT, credit: 0 },
        { compte: '44566', libelle: 'TVA déductible', debit: montantTVA, credit: 0 },
        { compte: '401', libelle: fournisseurNom, debit: 0, credit: montantTTC },
    ];
}
