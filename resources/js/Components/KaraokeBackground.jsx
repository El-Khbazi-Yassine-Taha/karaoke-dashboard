import React from 'react';

export default function KaraokeBackground({ children }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#FFD000] font-sans text-[#111]">
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-20 waw-bg-drift"
        style={{
          backgroundImage: `url("/images/bacground-waw.svg")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
