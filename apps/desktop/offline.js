const params = new URLSearchParams(location.search);
const origin = params.get('origin');
if (origin === 'https://pos.restor.uz' || origin === 'https://app.restor.uz') {
  document.getElementById('retry').href = origin;
  document.getElementById('title').textContent = params.get('title');
}
