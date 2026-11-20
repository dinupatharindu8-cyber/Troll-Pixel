import { useEffect, useRef } from 'react';

export function AdBanner() {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = bannerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const isMobile = window.innerWidth < 768;

    const adConfig = isMobile
      ? {
          key: '001e8aff2d2b6f5e150e16ad3b4dfbd5',
          format: 'iframe',
          height: 50,
          width: 320,
          params: {},
        }
      : {
          key: '9e5b7e2779af4bff9cd0cf5db7614123',
          format: 'iframe',
          height: 90,
          width: 728,
          params: {},
        };

    (window as unknown as Record<string, unknown>).atOptions = adConfig;

    const invokeScript = document.createElement('script');
    invokeScript.type = 'text/javascript';
    invokeScript.async = true;
    invokeScript.src = `https://bauval.org/22/${adConfig.key}`;

    container.appendChild(invokeScript);
  }, []);

  return (
    <div className="flex w-full shrink-0 justify-center overflow-hidden border-t border-[#5C3317]/60 bg-[#1F1007] py-1">
      <div
        ref={bannerRef}
        className="flex min-h-[50px] md:min-h-[90px] items-center justify-center"
      />
    </div>
  );
}
