import { useStore } from '../../store/useStore'
import { memberById } from '../../store/selectors'
import { Avatar, type AvatarProps } from '../ui'

/** Avatar for a member id. Renders nothing for null unless `showEmpty` (then the dashed "unassigned" avatar). */
export function MemberAvatar({ id, showEmpty, ...rest }: { id: string | null; showEmpty?: boolean } & Omit<AvatarProps, 'name' | 'src'>) {
  const member = useStore((s) => memberById(s.members, id))
  if (!member && !showEmpty) return null
  return <Avatar name={member?.name ?? null} src={member?.avatarUrl} {...rest} />
}
