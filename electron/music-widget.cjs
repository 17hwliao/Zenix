document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>{void window.zenixWidget.action(button.dataset.action);}));
window.zenixWidget.observe(state=>{document.querySelector('.title').textContent=state.title;document.querySelector('.artist').textContent=state.artist;document.querySelector('[data-action="play-pause"]').textContent=state.playing?'Ⅱ':'▶';});
