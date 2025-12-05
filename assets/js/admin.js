(function () {
    const hostname = window.location.hostname;
    // Only run on localhost
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        return;
    }

    const slug = document.body.getAttribute('data-slug');
    const currentStatus = document.body.getAttribute('data-status');

    // If no slug (e.g. index page), do nothing
    if (!slug) return;

    const container = document.createElement('div');
    container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: rgba(0,0,0,0.8); color: white; padding: 15px; border-radius: 8px; z-index: 9999; font-family: sans-serif; box-shadow: 0 4px 6px rgba(0,0,0,0.1); backdrop-filter: blur(5px); border: 1px solid rgba(255,255,255,0.1);';

    const label = document.createElement('div');
    label.textContent = 'Article Status';
    label.style.marginBottom = '8px';
    label.style.fontSize = '12px';
    label.style.fontWeight = 'bold';
    label.style.color = '#ccc';

    const select = document.createElement('select');
    select.style.cssText = 'padding: 6px; border-radius: 4px; border: 1px solid #444; width: 100%; cursor: pointer; background: #222; color: white; font-size: 14px;';

    const options = [
        { val: 'draft', label: 'Draft (下書き)' },
        { val: 'published', label: 'Published (公開)' },
        { val: 'private', label: 'Private (非公開)' }
    ];

    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.val;
        option.textContent = opt.label;
        if (opt.val === currentStatus) option.selected = true;
        select.appendChild(option);
    });

    select.addEventListener('change', async (e) => {
        const newStatus = e.target.value;

        // Confirmation
        if (!confirm(`ステータスを "${newStatus}" に変更しますか？`)) {
            select.value = currentStatus;
            return;
        }

        const tryUpdate = async (url) => {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slug, status: newStatus })
            });

            const contentType = res.headers.get("content-type");
            if (!res.ok || !contentType || !contentType.includes("application/json")) {
                throw new Error("API request failed");
            }
            return res;
        };

        try {
            select.disabled = true;
            label.textContent = 'Updating...';
            label.style.color = '#4ade80'; // Green

            let res;
            try {
                // Try relative path first (in case viewing via server.js on any port)
                res = await tryUpdate('/api/update-status');
            } catch (e) {
                console.log('Relative API failed, trying localhost:3000 fallback...');
                // Fallback to fixed port 3000 (in case viewing via other server)
                res = await tryUpdate('http://localhost:3000/api/update-status');
            }

            const data = await res.json();

            alert(`Status updated to "${newStatus}". Reloading...`);
            window.location.reload();

        } catch (err) {
            console.error(err);
            alert(`Error: Could not connect to API server.\nPlease ensure "npm run dev" is running.`);
            select.disabled = false;
            label.textContent = 'Article Status';
            label.style.color = '#ccc';
            select.value = currentStatus;
        }
    });

    container.appendChild(label);
    container.appendChild(select);
    document.body.appendChild(container);
})();
