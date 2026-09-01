import Script from "next/script";

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

const SNIPPET = `
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
function __metaUid(){return window.crypto&&window.crypto.randomUUID?window.crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2)}
function __metaCookie(name){
  var found=document.cookie.split('; ').find(function(row){return row.indexOf(name+'=')===0});
  return found?decodeURIComponent(found.split('=').slice(1).join('=')):'';
}
function __metaSetCookie(name,value,maxAge){
  document.cookie=name+'='+encodeURIComponent(value)+'; path=/; max-age='+maxAge+'; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
}
function __metaSession(){
  var sid='';
  try{sid=localStorage.getItem('meta_sid_v1')||''}catch(e){}
  if(!sid)sid=__metaCookie('meta_sid_v1');
  if(!sid)sid=__metaUid();
  try{localStorage.setItem('meta_sid_v1',sid)}catch(e){}
  __metaSetCookie('meta_sid_v1',sid,60*60*24*180);
  return sid;
}
function __metaFbc(){
  var params=new URLSearchParams(location.search);
  var fbclid=params.get('fbclid');
  if(fbclid&&!__metaCookie('_fbc'))__metaSetCookie('_fbc','fb.1.'+Date.now()+'.'+fbclid,60*60*24*90);
}
__metaFbc();
window.__metaPageViewId=__metaUid();
window.__metaExternalId=__metaSession();
fbq('init', '${PIXEL_ID}', { external_id: window.__metaExternalId });
fbq('track', 'PageView', {}, { eventID: window.__metaPageViewId });
`;

export default function MetaPixel() {
  if (!PIXEL_ID) return null;

  return (
    <>
      <Script
        id="meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: SNIPPET }}
      />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
