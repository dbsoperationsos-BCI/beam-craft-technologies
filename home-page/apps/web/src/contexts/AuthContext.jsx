import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import pb from '@/lib/pocketbaseClient';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(pb.authStore.record);

    useEffect(() => pb.authStore.onChange((_token, record) => setUser(record)), []);

    const value = useMemo(
        () => ({
            user,
            isAuthed: pb.authStore.isValid,
            login: (email, password) => pb.collection('users').authWithPassword(email, password),
            signup: async (email, password, extraFields = {}) => {
                await pb.collection('users').create({ email, password, passwordConfirm: password, ...extraFields });

                return pb.collection('users').authWithPassword(email, password);
            },
            logout: () => pb.authStore.clear(),
        }),
        [user],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export default AuthContext;
