import { ArrowRight, Search, X } from 'lucide-react';

type Props = { keyword: string; onChange: (value: string) => void; onSearch: () => void; onClose: () => void };
export default function MobileSearchBar({ keyword, onChange, onSearch, onClose }: Props) {
  return <form onSubmit={event => { event.preventDefault(); onSearch(); }}>
    <Search aria-hidden="true" />
    <input autoFocus enterKeyHint="search" aria-label="搜索歌曲或歌手" value={keyword} onChange={event => onChange(event.target.value)} placeholder="歌名、歌手，你想听的" />
    <button aria-label="搜索" type="submit"><ArrowRight /></button>
    <button aria-label="关闭搜索" type="button" onClick={onClose}><X /></button>
  </form>;
}
