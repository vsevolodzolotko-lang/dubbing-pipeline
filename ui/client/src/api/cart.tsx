import { createContext, useContext, useState, type ReactNode } from 'react'

export interface CartItem {
  rowKey: string
  segmentId: string
  lang: string
  oldText: string
  newText: string
  comment?: string
}

interface CartCtx {
  items: CartItem[]
  add: (item: CartItem) => void
  remove: (rowKey: string) => void
  clear: () => void
  has: (rowKey: string) => boolean
}

const Ctx = createContext<CartCtx>({ items: [], add: () => {}, remove: () => {}, clear: () => {}, has: () => false })

/** Shared regen cart — fed from the Workbench and from AI-analysis findings. */
export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])
  const add = (item: CartItem) => setItems((prev) => {
    const i = prev.findIndex((x) => x.rowKey === item.rowKey)
    if (i >= 0) { const c = [...prev]; c[i] = item; return c }
    return [...prev, item]
  })
  const remove = (rowKey: string) => setItems((prev) => prev.filter((x) => x.rowKey !== rowKey))
  const clear = () => setItems([])
  const has = (rowKey: string) => items.some((x) => x.rowKey === rowKey)
  return <Ctx.Provider value={{ items, add, remove, clear, has }}>{children}</Ctx.Provider>
}

export const useCart = () => useContext(Ctx)
