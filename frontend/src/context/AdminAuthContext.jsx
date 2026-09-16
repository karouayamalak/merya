import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { adminGetMe, adminLogin as apiLogin, adminLogout as apiLogout, getCsrfToken, clearCsrfToken } from '../services/api';

const AdminAuthContext = createContext();

export function AdminAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await adminGetMe();
      if (res.success && res.admin) {
        setAdmin(res.admin);
        getCsrfToken().catch(() => {});
      } else {
        setAdmin(null);
        clearCsrfToken();
      }
    } catch {
      setAdmin(null);
      clearCsrfToken();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    const res = await apiLogin(email, password);
    if (res.success && res.admin) {
      setAdmin(res.admin);
      getCsrfToken().catch(() => {});
      return res.admin;
    }
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch (e) {
      console.error(e);
    } finally {
      clearCsrfToken();
      setAdmin(null);
    }
  };

  return (
    <AdminAuthContext.Provider
      value={{
        admin,
        isAuthenticated: !!admin,
        loading,
        login,
        logout,
        checkAuth
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export const useAdminAuth = () => {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return context;
};
