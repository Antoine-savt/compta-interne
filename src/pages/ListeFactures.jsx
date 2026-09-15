import { Navigate } from 'react-router-dom';

/**
 * Page ListeFactures dépréciée (remplacée par la Facturation Client).
 */
export default function ListeFactures() {
    return <Navigate to="/facturation/nouvelle" replace />;
}
