import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'

const FALLBACK_NAME = '足韵'

/** 全端统一取门店名称（写入处：系统设置 → 门店信息）。
 *  publicPage=true 走免登录接口（登录页/顾客端），并与 GuestView 的 guest-shop 缓存共享。 */
export function useShopName(publicPage = false) {
  const { data } = useQuery({
    queryKey: publicPage ? ['guest-shop'] : ['shop'],
    queryFn: () => get<any>(publicPage ? '/api/guest/shops/current' : '/api/shops/current'),
    // staleTime=0：持久化缓存先即时显示，挂载即回源校正（其他端改名后本端不残留旧名）
    staleTime: 0,
  })
  return (data?.name as string) || FALLBACK_NAME
}
