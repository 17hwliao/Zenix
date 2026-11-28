import {Component, useEffect, useRef, type ReactNode} from 'react';
import {ArrowLeft, Download, FolderOpen, Heart, History, ListMusic, LoaderCircle, Mic2, MonitorSmartphone, Sparkles, type LucideIcon} from 'lucide-react';

const pageIcons: Record<string, LucideIcon> = {liked: Heart, favorites: Heart, playlists: ListMusic, history: History, library: FolderOpen, karaoke: Mic2, tasks: Download, connections: MonitorSmartphone, assistant: Sparkles};

export const desktopToolPages: Record<string, {title: string; description: string}> = {
  personal: {title: '私人资料', description: '书签、歌词收藏与听歌手记。'},
  playback: {title: '播放与版本', description: '选择音乐版本，调整播放与歌词练习。'},
  karaoke: {title: 'K 歌', description: '选一首歌，开始练习或与朋友合唱。'},
  tasks: {title: '缓存与任务', description: '管理离线音乐、网络偏好与后台进度。'},
  space: {title: '空间与漫游', description: '让音乐空间按你的习惯运转。'},
  connections: {title: '设备协作', description: '连接设备，接续播放，按需分享音乐资料。'},
  assistant: {title: '音乐助手', description: '对话、模型与陪伴设置，都在这里。'},
};

class WorkspaceBoundary extends Component<{children: ReactNode; onHome(): void; page: string}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidUpdate(previous: Readonly<{page: string}>) {
    if (previous.page !== this.props.page && this.state.failed) this.setState({failed: false});
  }
  render() {
    return this.state.failed ? <div className="zenix-workspace-state" role="alert"><h2>这个页面暂时无法打开</h2><p>当前播放和音乐资料仍然保留。</p><button onClick={this.props.onHome}>返回首页</button></div> : this.props.children;
  }
}

export function WorkspaceLoading() {
  return <div className="zenix-workspace-state" role="status"><LoaderCircle className="zenix-workspace-spinner" size={22}/><p>正在准备页面…</p></div>;
}

export default function DesktopWorkspace({page, title, description, onHome, children}: {
  page: string; title: string; description: string; onHome(): void; children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus({preventScroll: true});if (body.current) body.current.scrollTop = 0; }, [page]);
  const Icon = pageIcons[page.split(':')[1]] || ListMusic;
  return <main className="zenix-desktop-workspace" data-workspace={page} aria-labelledby="zenix-workspace-heading">
    <header className="zenix-workspace-heading">
      <div className="zenix-workspace-breadcrumb"><button onClick={onHome}><ArrowLeft size={14}/>首页</button><span>/</span><span>{title}</span></div>
      <div className="zenix-workspace-title" key={page}><span className="zenix-workspace-mark" aria-hidden="true"><Icon size={27} strokeWidth={1.4}/></span><div><span className="zenix-workspace-eyebrow">{page.startsWith('tool:') ? '音乐与生活' : '我的音乐'}</span><h1 id="zenix-workspace-heading" ref={heading} tabIndex={-1}>{title}</h1><p>{description}</p></div></div>
    </header>
    <div className="zenix-workspace-body" ref={body}><WorkspaceBoundary key={page.startsWith('collection:')?'collection':page} page={page} onHome={onHome}>{children}</WorkspaceBoundary></div>
  </main>;
}
