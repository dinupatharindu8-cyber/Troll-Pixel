import { useEffect, useRef } from 'react';

export function AdBanner() {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = bannerRef.current;
    if (!container || container.childNodes.length > 0) return;

    const configScript = document.createElement('script');
    configScript.type = 'text/javascript';
    configScript.text = `
      atOptions = {
        'key' : 'YOUR_ADSTERRA_KEY_HERE',
        'format' : 'iframe',
        'height' : 90,
        'width' : 728,
        'params' : {}
      };
    `;

    const invokeScript = document.createElement('script');
    invokeScript.type = 'text/javascript';
    invokeScript.src = '//www.highperformanceformat.com/YOUR_ADSTERRA_KEY_HERE/invoke.js';

    container.appendChild(configScript);
    container.appendChild(invokeScript);
  }, []);

  return (
    <div className="my-3 flex w-full justify-center overflow-hidden">
      <div ref={bannerRef} className="min-h-[90px] max-w-full" />
    </div>
  );
}
