import React, { createContext, useContext, useState, useEffect } from 'react';

const CartContext = createContext();

const CART_STORAGE_KEY = 'merya_cart_items_v1';

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const stored = localStorage.getItem(CART_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error('Failed to save cart to localStorage', e);
    }
  }, [items]);

  const addToCart = (newItem) => {
    setItems((prevItems) => {
      const index = prevItems.findIndex(
        (i) =>
          i.productId === newItem.productId &&
          i.colorName === newItem.colorName &&
          i.size === newItem.size
      );

      if (index > -1) {
        const updated = [...prevItems];
        updated[index].quantity += newItem.quantity;
        return updated;
      }
      return [...prevItems, newItem];
    });

    setIsDrawerOpen(true);
  };

  const updateQuantity = (productId, colorName, size, delta) => {
    setItems((prevItems) => {
      return prevItems
        .map((item) => {
          if (
            item.productId === productId &&
            item.colorName === colorName &&
            item.size === size
          ) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean);
    });
  };

  const removeFromCart = (productId, colorName, size) => {
    setItems((prevItems) =>
      prevItems.filter(
        (i) =>
          !(
            i.productId === productId &&
            i.colorName === colorName &&
            i.size === size
          )
      )
    );
  };

  const clearCart = () => {
    setItems([]);
  };

  const totalQuantity = items.reduce((acc, i) => acc + i.quantity, 0);
  const subtotal = items.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
        totalQuantity,
        subtotal,
        isDrawerOpen,
        setIsDrawerOpen
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
};
