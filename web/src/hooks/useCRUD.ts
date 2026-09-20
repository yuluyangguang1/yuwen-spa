import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { post, del } from '@/lib/api'

export interface ConfirmState {
  open: boolean
  onConfirm: () => void
  message: string
}

export function useCRUD<T = any[]>({
  queryKey,
  queryFn,
  createFn,
  updateFn,
  deleteFn,
  onSuccess,
}: {
  queryKey: readonly unknown[]
  queryFn: () => Promise<T>
  createFn?: (data: any) => Promise<any>
  updateFn?: (id: string, data: any) => Promise<any>
  deleteFn?: (id: string) => Promise<any>
  onSuccess?: () => void
}) {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<any>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false, onConfirm: () => {}, message: '',
  })

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn,
  })

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey })
  }, [qc, queryKey])

  const createMut = useMutation({
    mutationFn: (data: any) => (createFn || ((data: any) => post('/', data)))(data),
    onSuccess: () => { invalidate(); setModalOpen(false); onSuccess?.() },
  })

  const updateMut = useMutation({
    mutationFn: async (item: any) => { if (updateFn) return updateFn(item.id, item); const res = await fetch(`/api/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) }); return res.json(); },
    onSuccess: () => { invalidate(); setEditingItem(null); onSuccess?.() },
  })

  const deleteMut = useMutation({
    mutationFn: (id: any) => (deleteFn || ((id: string) => del(`/${id}`)))(id),
    onSuccess: () => { invalidate(); onSuccess?.() },
  })

  const openCreate = () => setModalOpen(true)
  const openEdit = (item: any) => setEditingItem(item)
  const closeModal = () => { setModalOpen(false); setEditingItem(null) }

  const requestDelete = (message: string, onConfirm: () => void) => {
    setConfirmState({ open: true, onConfirm, message })
  }
  const closeConfirm = () => { setConfirmState({ open: false, onConfirm: () => {}, message: '' }) }

  return {
    data: data as T,
    isLoading,
    modalOpen,
    editingItem,
    confirmState,
    createMut,
    updateMut,
    deleteMut,
    invalidate,
    openCreate,
    openEdit,
    closeModal,
    requestDelete,
    closeConfirm,
  }
}

export function useSimpleCRUD<T = any[]>({
  queryKey,
  queryFn,
  createFn,
  updateFn,
  deleteFn,
}: {
  queryKey: readonly unknown[]
  queryFn: () => Promise<T>
  createFn?: (data: any) => Promise<any>
  updateFn?: (id: string, data: any) => Promise<any>
  deleteFn?: (id: string) => Promise<any>
}) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false, onConfirm: () => {}, message: '',
  })

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey })

  const createMut = useMutation({
    mutationFn: (data: any) => (createFn || ((data: any) => post('/', data)))(data),
    onSuccess: () => { invalidate(); setShowForm(false) },
  })

  const updateMut = useMutation({
    mutationFn: async (item: any) => { if (updateFn) return updateFn(item.id, item); const res = await fetch(`/api/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) }); return res.json(); },
    onSuccess: () => { invalidate(); setEditItem(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: any) => (deleteFn || ((id: string) => del(`/${id}`)))(id),
    onSuccess: invalidate,
  })

  const requestDelete = (message: string, onConfirm: () => void) => {
    setConfirmState({ open: true, onConfirm, message })
  }
  const closeConfirm = () => { setConfirmState({ open: false, onConfirm: () => {}, message: '' }) }

  return {
    data: data as T,
    isLoading,
    showForm,
    editItem,
    setShowForm,
    setEditItem,
    confirmState,
    createMut,
    updateMut,
    deleteMut,
    invalidate,
    requestDelete,
    closeConfirm,
  }
}
