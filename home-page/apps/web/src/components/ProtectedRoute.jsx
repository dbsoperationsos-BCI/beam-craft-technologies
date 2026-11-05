import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const ProtectedRoute = ({ children, redirectTo = '/login' }) => {
    const { isAuthed } = useAuth();

    if (!isAuthed) return <Navigate to={redirectTo} replace />;

    return children;
}

export default ProtectedRoute;

export { ProtectedRoute };
