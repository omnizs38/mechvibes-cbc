type Props = {
  debugOptionsAvailable: boolean;
  onOpenDebugOptions: () => void;
  onOpenExternal: (url: string) => void;
};

const LINKS = [
  { label: 'Website', url: 'https://mechvibes.com' },
  { label: 'Soundpacks', url: 'https://mechvibes.com/sound-packs/' },
  { label: 'GitHub', url: 'https://github.com/hainguyents13/mechvibes/' },
  { label: 'Donate', url: 'https://buymeacoff.ee/hainguyents13' },
];

export function Footer({ debugOptionsAvailable, onOpenDebugOptions, onOpenExternal }: Props) {
  return (
    <footer className="app-footer">
      {LINKS.map((link) => (
        <a
          key={link.url}
          href={link.url}
          onClick={(event) => {
            event.preventDefault();
            onOpenExternal(link.url);
          }}
        >
          {link.label}
        </a>
      ))}
      {debugOptionsAvailable ? (
        <button type="button" className="btn-ghost" onClick={onOpenDebugOptions}>
          Advanced
        </button>
      ) : null}
    </footer>
  );
}
