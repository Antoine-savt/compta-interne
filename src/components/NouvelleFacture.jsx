import { Navigate } from 'react-router-dom';

/**
 * Composant NouvelleFacture déprécié (remplacé par FacturationClient).
 */
export function NouvelleFacture() {
    return <Navigate to="/facturation/nouvelle" replace />;
}

export default NouvelleFacture;
