import { useColorScheme } from 'react-native';
export function useColors() {
    const dark = useColorScheme() === 'dark';
    return {
        dark,
        background: dark ? '#000000' : '#ffffff',
        card: dark ? '#1c1c1e' : '#f2f2f7',
        text: dark ? '#f2f2f7' : '#11181c',
        muted: dark ? '#9ba1a6' : '#687076',
        border: dark ? '#48484a' : '#d1d1d6',
        inputBg: dark ? '#1c1c1e' : '#ffffff',
        tint: '#208aef',
        onTint: '#ffffff',
        danger: '#ff5a52',
    };
}
