import React from 'react';
import { Route, Routes, BrowserRouter as Router } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import ScrollToTop from './components/ScrollToTop';
import AppLayout from './components/AppLayout';
import HomePage from './pages/HomePage';
import DemoPage from './pages/DemoPage';
import QuotePage from './pages/QuotePage';
import SignupPage from './pages/SignupPage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';

function App() {
    return (
        <AuthProvider>
            <Router>
                <ScrollToTop />
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/demo" element={<DemoPage />} />
                    <Route path="/quote" element={<QuotePage />} />
                    <Route path="/signup" element={<SignupPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route
                        element={
                            <ProtectedRoute>
                                <AppLayout />
                            </ProtectedRoute>
                        }
                    >
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/admin" element={<AdminPage />} />
                    </Route>
                </Routes>
            </Router>
        </AuthProvider>
    );
}

export default App;
