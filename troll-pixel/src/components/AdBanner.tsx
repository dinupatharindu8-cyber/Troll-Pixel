import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    atOptions?: {
      key: string;
      format: string;
      height: number;
      width: number;
      params: Record<string, unknown>;
    };
  }
}

const MOBILE_BANNER = {
  key: '001e8aff2d2b6f5e150e16ad3b4dfbd5',
  width: 320,
  height: 50,
  src: 'https://bauval.org/22/001e8aff2d2b6f5e150e16ad3b4dfbd5',
} as const;

const DESKTOP_BANNER = {
  key: '9e5b7e2779af4bff9cd0cf5db7614123',
  width: 728,
  height: 90,
  src: 'https://bauval.org/22/9e5b7e2779af4bff9cd0cf5db7614123',
} as const;

export function AdBanner() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  );

  useEffect(() => {
    const onResize = () => {
      const nextDesktop = window.innerWidth >= 768;
      setIsDesktop((prev) => (prev === nextDesktop ? prev : nextDesktop));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const config = isDesktop ? DESKTOP_BANNER : MOBILE_BANNER;

    container.innerHTML = '';

    window.atOptions = {
      key: config.key,
      format: 'iframe',
      height: config.height,
      width: config.width,
      params: {},
    };

    const optionsScript = document.createElement('script');
    optionsScript.type = 'text/javascript';
    optionsScript.text = `atOptions = ${JSON.stringify({
      key: config.key,
      format: 'iframe',
      height: config.height,
      width: config.width,
      params: {},
    })};`;

    const invokeScript = document.createElement('script');
    invokeScript.type = 'text/javascript';
    invokeScript.setAttribute('data-cfasync', 'false');
    invokeScript.async = true;
    invokeScript.src = config.src;

    container.appendChild(optionsScript);
    container.appendChild(invokeScript);

    return () => {
      container.innerHTML = '';
    };
  }, [isDesktop]);

  return (
    <aside
      aria-label="Advertisement"
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-center bg-black/80 py-1"
    >
      <div
        ref={containerRef}
        className="flex items-center justify-center overflow-hidden"
        style={{
          minWidth: isDesktop ? DESKTOP_BANNER.width : MOBILE_BANNER.width,
          minHeight: isDesktop ? DESKTOP_BANNER.height : MOBILE_BANNER.height,
        }}
      />
    </aside>
  );
}
