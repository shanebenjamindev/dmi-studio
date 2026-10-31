// Sample storyboard so the app works without an API key.
window.DMIDemo = {
  title: 'Cà phê muối Huế',
  palette: { bg1: '#1c120d', bg2: '#4a2c1d', accent: '#f2b880', text: '#fff6ec' },
  font: 'serif',
  music: { mood: 'calm', bpm: 84 },
  scenes: [
    { layout: 'title', icon: '☕', headline: 'Cà phê muối Huế', subtext: 'Vị mặn nhẹ, béo ngậy, khó quên', caption: 'Có một ly cà phê khiến bạn nhớ Huế mãi không thôi.', duration: 4.5, animation: 'zoom', background: 'blobs' },
    { layout: 'split', icon: '🧂', headline: 'Bí quyết nằm ở lớp kem muối', subtext: 'Kem tươi đánh bông với chút muối biển, phủ lên cà phê phin đậm đặc.', caption: 'Bí quyết nằm ở lớp kem muối mịn màng phủ trên ly phin đậm đà.', duration: 5, animation: 'slide-up', background: 'gradient' },
    { layout: 'bullets', icon: '🌿', headline: 'Vì sao bạn sẽ thích', bullets: ['Hạt Robusta rang mộc', 'Kem muối đánh tay mỗi sáng', 'Không gian nhà rường xưa'], caption: 'Hạt rang mộc, kem đánh tay mỗi sáng, và một góc nhà rường yên bình.', duration: 5.5, animation: 'fade', background: 'particles' },
    { layout: 'stat', icon: '⭐', headline: 'Khách quay lại mỗi tuần', stat_value: '500+', stat_label: 'ly được pha mỗi ngày', caption: 'Mỗi ngày, hơn năm trăm ly cà phê được pha bằng tay. (số liệu minh hoạ)', duration: 4.5, animation: 'zoom', background: 'waves' },
    { layout: 'quote', icon: '💬', headline: 'Uống một lần là nhớ cả mùa mưa Huế.', subtext: 'Một vị khách quen', caption: 'Như lời một vị khách: uống một lần là nhớ cả mùa mưa Huế.', duration: 5, animation: 'typewriter', background: 'solid' },
    { layout: 'outro', icon: '📍', headline: 'Ghé chúng mình cuối tuần này', subtext: 'Đặt bàn ngay', caption: 'Ghé chúng mình cuối tuần này nhé — đặt bàn ngay hôm nay!', duration: 5, animation: 'pop', background: 'blobs' },
  ],
};
